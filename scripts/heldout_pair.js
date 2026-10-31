'use strict';

/**
 * Heldout A/B pair runner.
 *
 * One task, two arms, same model, isolated workspaces, verified by the repo's
 * own tests. Nothing is scored unless a test proves the workspace changed and
 * still passes; a token count is never allowed to stand in for success.
 *
 *   node scripts/heldout_pair.js --task <id> --model <provider/model>
 *
 * Writes runs/ruliad/heldout_pairs/<id>.json. The aggregate scorer reads only
 * these receipts, so a report can never claim a run that did not happen.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const PI_BIN = '/opt/homebrew/bin/pi';
const OUT_DIR = path.join(REPO, 'runs/ruliad/heldout_pairs');

// The files an arm is permitted to touch for a command task. Wrong-file
// rate is measured against this set, not guessed from the diff size.
const SCOPE = ['agent-os', 'src/proof.js'];

const TASKS = {
  s01: { id: 's01', task: 'add a proof-dry-run command to agent-os that prints "dry" and exits 0', cmd: 'proof-dry-run', expect: 'dry' },
  s02: { id: 's02', task: 'add a proof-version command to agent-os that prints the package.json version', cmd: 'proof-version', expect: '0.2.0' },
  s03: { id: 's03', task: 'add a proof-decision command to agent-os that prints proofStatus().decision', cmd: 'proof-decision', expect: 'canary_progress_hold_promotion' },
  s04: { id: 's04', task: 'add a proof-lane-count command to agent-os that prints the number of lanes in grandHypothesisProof()', cmd: 'proof-lane-count', expect: '4' },
  s05: { id: 's05', task: 'add a proof-json-min command to agent-os that prints minified JSON of proofStatus()', cmd: 'proof-json-min', expect_json: true },
  s06: { id: 's06', task: 'add a proof-missing-count command to agent-os that prints the length of proofStatus().missing_for_promotion', cmd: 'proof-missing-count', expect: '1' },
  s07: { id: 's07', task: 'add a proof-binary command to agent-os that prints the sentence "no binary required"', cmd: 'proof-binary', expect: 'no binary required' },
  s08: { id: 's08', task: 'add a proof-check command to agent-os that prints the string "checked"', cmd: 'proof-check', expect: 'checked' },
  s09: { id: 's09', task: 'add a proof-count command to agent-os that prints the number of fields in proofStatus()', cmd: 'proof-count', expect: '2' },
  s10: { id: 's10', task: 'add a proof-empty command to agent-os that prints "empty" and exits 0', cmd: 'proof-empty', expect: 'empty' },
  s11: { id: 's11', task: 'add a proof-tag command to agent-os that prints the literal string "agent-os"', cmd: 'proof-tag', expect: 'agent-os' },
  s12: { id: 's12', task: 'add a proof-blank command to agent-os that prints "blank"', cmd: 'proof-blank', expect: 'blank' },
  s13: { id: 's13', task: 'add a proof-word command to agent-os that prints the number of characters in the string "agent-os"', cmd: 'proof-word', expect: '8' },
  s14: { id: 's14', task: 'add a proof-even command to agent-os that prints "yes" if 4 is even and exits 0', cmd: 'proof-even', expect: 'yes' },
  s15: { id: 's15', task: 'add a proof-zero command to agent-os that prints 0', cmd: 'proof-zero', expect: '0' },
  s16: { id: 's16', task: 'add a proof-one command to agent-os that prints 1', cmd: 'proof-one', expect: '1' },
  s17: { id: 's17', task: 'add a proof-two command to agent-os that prints 2', cmd: 'proof-two', expect: '2' },
  s18: { id: 's18', task: 'add a proof-three command to agent-os that prints 3', cmd: 'proof-three', expect: '3' },
  s19: { id: 's19', task: 'add a proof-four command to agent-os that prints 4', cmd: 'proof-four', expect: '4' },
  s20: { id: 's20', task: 'add a proof-five command to agent-os that prints 5', cmd: 'proof-five', expect: '5' },
};

function copyRepo(src, dst) {
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    if (['.git', 'runs', 'node_modules', '.DS_Store', '.omp', '.pi', 'archive'].includes(item)) continue;
    const s = path.join(src, item);
    const d = path.join(dst, item);
    if (fs.statSync(s).isDirectory()) fs.cpSync(s, d, { recursive: true });
    else fs.copyFileSync(s, d);
  }
}

function treeHash(dir) {
  const crypto = require('node:crypto');
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === 'node_modules' || name === '.git') continue;
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

/**
 * Commit the tree as the baseline, BEFORE an arm runs. The copy drops .git, so a
 * temp repo gives a real baseline without depending on the user's index.
 *
 * This must happen first. Committing after the arm has written would fold the
 * arm's own files into the baseline, leaving `git status` empty and every
 * wrong-file rate a structural zero.
 */
function snapshotBaseline(dir) {
  spawnSync('git', ['-C', dir, 'init', '-q'], { timeout: 20000 });
  spawnSync('git', ['-C', dir, 'add', '-A'], { timeout: 20000 });
  const res = spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'base'], { timeout: 30000 });
  return res.status === 0;
}

function changedFiles(dir) {
  const res = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', timeout: 10000 });
  if (res.status !== 0) return null;
  return (res.stdout || '').split('\n').filter(Boolean).map((line) => line.slice(3).trim());
}

function wrongFile(dir, scope) {
  const files = changedFiles(dir);
  // No git means no measurement. null is not "zero wrong files".
  if (files === null) return null;
  return files.filter((f) => !scope.includes(f)).length;
}

function runArmOnceSync({ dir, prompt, model, timeoutMs }) {
  const t0 = Date.now();
  const res = spawnSync(PI_BIN, ['-a', '--model', model, '--thinking', 'low', '-p', prompt], {
    cwd: dir, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  const err = (res.stderr || '') + (res.stdout || '');
  // A 429 is the provider refusing to serve; it says nothing about the arm.
  // Counting it as a failure would blame the model for the queue.
  const providerError = /\b429\b|provider_overloaded|at capacity/.test(err) ? 'provider_overloaded' : null;
  return {
    status: res.status === 0 ? 'completed' : res.error ? 'timeout' : 'failed',
    provider_error: providerError,
    exit_code: res.status,
    elapsed_ms: Date.now() - t0,
    stdout: (res.stdout || '').slice(-600),
    stderr: (res.stderr || '').slice(-600),
  };
}

const { spawn } = require('node:child_process');

/** Same measurement as the sync path, but it yields the CPU while the model runs. */
function runArmOnceAsync({ dir, prompt, model, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(PI_BIN, ['-a', '--model', model, '--thinking', 'low', '-p', prompt], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (buf) => buf.toString().slice(-8000);
    child.stdout.on('data', (d) => { stdout = cap(stdout + d.toString()); });
    child.stderr.on('data', (d) => { stderr = cap(stderr + d.toString()); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const err = stderr + stdout;
      const providerError = /\b429\b|provider_overloaded|at capacity/.test(err) ? 'provider_overloaded' : null;
      resolve({
        status: timedOut ? 'timeout' : code === 0 ? 'completed' : 'failed',
        provider_error: providerError,
        exit_code: code,
        elapsed_ms: Date.now() - t0,
        stdout: stdout.slice(-600),
        stderr: stderr.slice(-600),
      });
    });
    child.on('error', () => resolve({ status: 'failed', provider_error: null, exit_code: null, elapsed_ms: Date.now() - t0, stdout: '', stderr: 'spawn failed' }));
  });
}

async function runArm(options) {
  const attempts = [];
  for (let i = 0; i < 3; i += 1) {
    const attempt = runArmOnceSync
      ? await runArmOnceAsync(options)
      : runArmOnceSync(options);
    attempts.push(attempt);
    if (!attempt.provider_error) return { ...attempt, attempts: attempts.length };
    await new Promise((r) => setTimeout(r, 10000 * (i + 1)));
  }
  return { ...attempts.at(-1), attempts: attempts.length };
}

/**
 * An arm succeeds only if the command exits 0 AND prints what the task asked
 * for. Exiting 0 with arbitrary output is not a pass: without this, a model can
 * print anything, and both arms pass every task, which manufactures the tie that
 * the promotion gate then correctly refuses.
 */
function verify(dir, spec) {
  const test = spawnSync('node', ['test/proof.test.js'], { cwd: dir, timeout: 30000, encoding: 'utf8' });
  const cli = spawnSync('./agent-os', [spec.cmd], { cwd: dir, timeout: 20000, encoding: 'utf8' });
  const stdout = (cli.stdout || '').trim();
  let outputOk = false;
  if (spec.expect_json) {
    try { outputOk = typeof JSON.parse(stdout) === 'object' && JSON.parse(stdout) !== null; } catch { outputOk = false; }
  } else if (typeof spec.expect === 'string') {
    outputOk = stdout === spec.expect;
  }
  return {
    test_pass: test.status === 0,
    cmd_exit: cli.status,
    cmd_output: stdout.slice(0, 200),
    expected: spec.expect_json ? '<json>' : spec.expect,
    output_ok: outputOk,
    cmd_ok: cli.status === 0 && outputOk,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const t0 = Date.now();
  const only = get('--task');
  const all = args.includes('--all');
  const concurrency = Number(get('--concurrency') || 4);
  const model = get('--model') || 'lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra';
  const ids = all ? Object.keys(TASKS) : [only];
  if (!only && !all) {
    console.error(`pass --task <id> or --all; known: ${Object.keys(TASKS).join(', ')}`);
    process.exit(2);
  }
  const unknown = ids.filter((id) => !TASKS[id]);
  if (unknown.length) {
    console.error(`unknown task ${unknown.join(', ')}; known: ${Object.keys(TASKS).join(', ')}`);
    process.exit(2);
  }

  // Pairs are independent isolated workspaces, so they run in a bounded pool.
  // Concurrency changes wall clock, never the verdict: each pair is still one
  // task, two arms, judged by its own command and its own test run.
  const queue = ids.slice();
  const results = [];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      results.push(await runPairTask(id, model));
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => ids.indexOf(a.task) - ids.indexOf(b.task));
  process.stdout.write(JSON.stringify({
    pairs: results.length,
    concurrency,
    wall_ms: Date.now() - t0,
    arm_ms: results.reduce((a, r) => a + r.direct_ms + r.controlled_ms, 0),
  }) + '\n');
}

async function runPairTask(taskId, model) {
  const task = TASKS[taskId];
  const base = path.join('/tmp/heldout_pairs', task.id);
  const direct = path.join(base, 'direct');
  const controlled = path.join(base, 'controlled');
  copyRepo(REPO, direct);
  copyRepo(REPO, controlled);
  // Baseline first: the arm's writes must be the diff, not the baseline.
  const directBased = snapshotBaseline(direct);
  const controlledBased = snapshotBaseline(controlled);
  const directBefore = treeHash(direct);
  const controlledBefore = treeHash(controlled);

  const anchor = "Command dispatch is a chain of `if (command === '<name>') return print(...)` lines around line 221 of the file `agent-os`. Add yours in the same style and the matching help line. Do not edit tests.";
  const ask = `In this repo, ${task.task}. ${anchor} Run node test/proof.test.js afterwards. Reply with a one-line summary.`;
  const governed = `In this repo, ${task.task}.
Boundaries: edit only agent-os (its command dispatch around the existing proof-* commands) and, if needed, src/proof.js. Do not edit tests; if a test enumerates commands, report it instead of changing the test.
Do not inspect unrelated files. Run node test/proof.test.js before claiming success.`;

  // The two arms are independent workspaces; running them at once halves the
  // wall clock without changing what is measured.
  const [directArm, controlledArm] = await Promise.all([
    runArm({ dir: direct, prompt: ask, model, timeoutMs: 120000 }),
    runArm({ dir: controlled, prompt: governed, model, timeoutMs: 120000 }),
  ]);

  // A snapshot that failed turns the wrong-file rate into null, not 0: no git
  // baseline means no measurement, and an unmeasured rate must never read as a
  // clean one.
  const directWrong = directBased ? wrongFile(direct, SCOPE) : null;
  const controlledWrong = controlledBased ? wrongFile(controlled, SCOPE) : null;
  const directAfter = treeHash(direct);
  const controlledAfter = treeHash(controlled);
  const directMod = directAfter !== directBefore;
  const controlledMod = controlledAfter !== controlledBefore;
  const directVerify = verify(direct, task);
  const controlledVerify = verify(controlled, task);

  const refused = directArm.provider_error || controlledArm.provider_error;
  const receipt = {
    schema: 'agent_os.heldout_pair.v2',
    usable: !refused,
    task: task.id,
    instruction: task.task,
    command: task.cmd,
    model,
    ran_at: new Date().toISOString(),
    arms: {
      direct: { ...directArm, mutated: directMod, wrong_files: directWrong, verify: directVerify },
      controlled: { ...controlledArm, mutated: controlledMod, wrong_files: controlledWrong, verify: controlledVerify },
    },
    // An arm counts only if the model changed the tree AND the command works
    // AND the repo's own test still passes. A timeout is a failure, not a tie.
    direct_success: directArm.status === 'completed' && directMod && directVerify.cmd_ok && directVerify.test_pass,
    controlled_success: controlledArm.status === 'completed' && controlledMod && controlledVerify.cmd_ok && controlledVerify.test_pass,
    claim_boundary: 'Two arms, same model, isolated copies, judged by the command and node test/proof.test.js. One task is not a population.',
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${task.id}.json`);
  fs.writeFileSync(out, JSON.stringify(receipt, null, 1) + '\n');
  process.stdout.write(JSON.stringify({
    task: task.id,
    direct: receipt.direct_success,
    controlled: receipt.controlled_success,
    direct_ms: directArm.elapsed_ms,
    controlled_ms: controlledArm.elapsed_ms,
    wrong_files: [directWrong, controlledWrong],
  }) + '\n');
  return {
    task: task.id,
    direct_success: receipt.direct_success,
    controlled_success: receipt.controlled_success,
    direct_ms: directArm.elapsed_ms,
    controlled_ms: controlledArm.elapsed_ms,
  };
}

if (require.main === module) {
  main().catch((err) => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
}
module.exports = { TASKS, verify, treeHash };
