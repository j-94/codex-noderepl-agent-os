'use strict';

/**
 * monitor_goal: a standing goal that observes both development loops, derives
 * what it must do from the loops' own receipts, and acts on main.
 *
 * observe() measures. selectAction() reads only observation. admit() turns the
 * chosen action into a signed, expiring admission. run() executes it.
 * No step invents its own input.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hash } = require('./core');
const { createAdmission, writeFileWithAdmission } = require('./effect_proxy');
const { proofStatus } = require('./proof');
const { fastRoute } = require('./fast_context_router');

const SCHEMA = 'agent_os.monitor_goal.v1';
const ROOT = path.resolve(__dirname, '..');
const RUNS = path.join(ROOT, 'runs/ruliad');
const DIRECTOR = path.join(ROOT, 'runs/monitor_workspace/dogfood/run.js');
const IMPROVE_STATE = 'runs/ruliad/monitor_checkpoints/improve.json';
const ESCALATION = 'runs/ruliad/monitor_escalation.json';
const HELDOUT = 'runs/ruliad/heldout_aggregate.json';
const HELDOUT_LEGACY = 'runs/ruliad/heldout_report.json';
const LEDGER = 'runs/ruliad/monitor_ledger.jsonl';

const LIMITS = Object.freeze({
  max_cycles: 20,
  min_delta: 0, // controlled rate must be >= baseline rate
  max_patch_bytes: 200 * 1024,
  max_attempts_per_run: 1,
});

const GOAL = Object.freeze({
  schema: SCHEMA,
  id: 'monitor.development-loop',
  statement:
    'Keep both development loops (dogfood chain and RSI routing loop) from silently degrading; repair them on main when they do.',
  authority: 'full_autonomy_on_main',
  loops: Object.freeze(['dogfood', 'improve']),
  limits: LIMITS,
  rollback:
    'Each write records prior bytes and a hash in its receipt. Revert: git checkout -- <path>.',
  evidence: Object.freeze([HELDOUT, HELDOUT_LEGACY, 'runs/ruliad/dogfood_receipt.json', IMPROVE_STATE]),
  claim_boundary:
    'Monitors these two loops and repairs the one file each loop owns. Not general software health.',
});

// ---------------------------------------------------------------- directory

function directorSource() {
  return `'use strict';
// Built by monitor_goal (repair_direct). Runs the dogfood chain end to end.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const N = ${JSON.stringify(ROOT)};
const B = '/Users/jobs/Desktop/tmp-meta3-engine-test';
const { bindCapabilities, extractGoalIds } = require(path.join(N, 'src/capability_bind'));

function probe(goal) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ goal_id: goal, run_id: 'm-' + Math.random().toString(36).slice(2), inputs: { intent: 'monitor ' + goal } });
    const req = http.request({ host: '127.0.0.1', port: 8080, path: '/run', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        const ev = (parsed && parsed.manifest && parsed.manifest.evidence) || {};
        resolve({
          code: res.statusCode,
          unknown: ev.unknown_goal === true || (ev.route_decision && ev.route_decision.selection_source === 'unknown_goal'),
          success: ev.actual_success,
        });
      });
    });
    req.on('error', (error) => resolve({ error: error.message }));
    req.end(body);
  });
}

(async () => {
  try {
    const engine = path.join(B, 'src/engine/mod.rs');
    const goals = extractGoalIds(fs.readFileSync(engine, 'utf8'));
    const ingest = path.join(B, 'runs/foundations_ingest');
    const runs = fs.readdirSync(ingest)
      .filter((name) => fs.existsSync(path.join(ingest, name, 'capability_inventory.json')))
      .map((name) => ({ name, at: fs.statSync(path.join(ingest, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    if (!runs.length) throw new Error('no capability inventory found under ' + ingest);
    const dir = path.join(ingest, runs[0].name);
    const inventory = JSON.parse(fs.readFileSync(path.join(dir, 'capability_inventory.json'), 'utf8'));
    const tools = JSON.parse(fs.readFileSync(path.join(dir, 'synthesized_tools.json'), 'utf8'));
    const bindings = bindCapabilities({ inventory, tools, goals, generatedAt: new Date().toISOString() });
    const reached = [...new Set(bindings.bindings.filter((b) => b.goal_id).map((b) => b.goal_id))];
    const probes = [];
    for (const goal of reached) probes.push({ goal, ...(await probe(goal)) });
    const receipt = {
      kind: 'agent_os.dogfood.v1',
      at: new Date().toISOString(),
      goals_declared: bindings.goal_count,
      goals_reached: reached.length,
      capabilities_bound: bindings.counts.bound,
      capabilities_total: bindings.counts.total,
      live: {
        alive: probes.filter((p) => !p.unknown && p.code !== 400 && !p.error).length,
        needs_input: probes.filter((p) => p.code === 400).length,
        rejected_as_unknown: probes.filter((p) => p.unknown).length,
        failed: probes.filter((p) => p.success === false).length,
        unreachable: probes.filter((p) => p.error).length,
      },
    };
    const out = path.join(N, 'runs/ruliad/dogfood_receipt.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(receipt, null, 1));
    process.stdout.write(JSON.stringify(receipt.live) + '\\n');
  } catch (error) {
    process.stderr.write(String(error && error.stack || error) + '\\n');
    process.exitCode = 1;
  }
})();
`;
}

// ------------------------------------------------------------------ observe

function score(loopSummary) {
  if (!loopSummary || !Array.isArray(loopSummary.cycles) || loopSummary.cycles.length === 0) return null;
  return {
    cycles: loopSummary.cycles.length,
    accepted: loopSummary.cycles.filter((c) => c.decisions && c.decisions.project === 'accepted').length,
    rules: (loopSummary.project && loopSummary.project.rules && loopSummary.project.rules.length) || 0,
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function observe() {
  const dogfood = readJson(path.join(RUNS, 'dogfood_receipt.json'));
  const checkpoint = readJson(path.join(ROOT, IMPROVE_STATE));
  const improve = checkpoint ? { ...checkpoint.state, cycles: checkpoint.state?.cycles || [] } : null;
  // The paired aggregate is the computed evidence; the legacy report is a single-arm fallback. R4
  // reads the aggregate, so the monitor reads it too - otherwise the two surfaces disagree about
  // whether the same run passed, and the escalation names a gate that the rung never consults.
  const heldout = readJson(path.join(ROOT, HELDOUT)) || readJson(path.join(ROOT, HELDOUT_LEGACY));
  const gate = proofStatus({ heldout_report: heldout || null });
  const director = fs.existsSync(DIRECTOR);

  // The two shapes name their arms differently: paired writes direct/controlled, legacy writes
  // baseline/candidate. Both are "the arm without the governed path" and "the arm with it".
  const rate = (paired, legacy) => (heldout && heldout.metrics
    ? Number(heldout.metrics[paired] ?? heldout.metrics[legacy] ?? 0) : null);
  const baseline = rate('direct_success_rate', 'baseline_success_rate');
  const controlled = rate('controlled_success_rate', 'candidate_success_rate');
  const improveScore = score(improve);

  return {
    at: new Date().toISOString(),
    director_present: director,
    dogfood: dogfood
      ? {
          measured: true,
          alive: dogfood.live?.alive ?? null,
          needed_input: dogfood.live?.needs_input ?? null,
          rejected_as_unknown: dogfood.live?.rejected_as_unknown ?? null,
          failed: dogfood.live?.failed ?? null,
        }
      : { measured: false },
    improve: improveScore ? { measured: true, ...improveScore } : { measured: false },
    heldout: { baseline, controlled, gate_missing: gate.missing_for_promotion },
  };
}

// -------------------------------------------------------------- selectAction

function selectAction(obs) {
  if (!obs.director_present) {
    return { kind: 'repair_direct', targets: [path.relative(ROOT, DIRECTOR)], why: 'the dogfood loop has no runner to run' };
  }
  if (!obs.dogfood.measured) {
    return { kind: 'run_measure', loop: 'dogfood', why: 'dogfood loop produced no receipt' };
  }
  if (!obs.improve.measured) {
    return { kind: 'run_measure', loop: 'improve', why: 'RSI loop has no checkpoint' };
  }
  if (obs.heldout.baseline === null || obs.heldout.controlled === null) {
    return { kind: 'escalate', why: 'heldout comparison is unmeasured' };
  }
  if (obs.heldout.controlled + LIMITS.min_delta < obs.heldout.baseline) {
    return { kind: 'escalate', why: `controlled ${obs.heldout.controlled} < direct ${obs.heldout.baseline}; regression is not repairable by this goal` };
  }
  if (obs.heldout.gate_missing.length > 0) {
    return { kind: 'escalate', why: `proof gate requires: ${obs.heldout.gate_missing.join('; ')}` };
  }
  if ((obs.dogfood.rejected_as_unknown || 0) > 0) {
    return { kind: 'run_measure', loop: 'dogfood', why: `dogfood admitted ${obs.dogfood.rejected_as_unknown} unknown goals` };
  }
  return { kind: 'hold', why: 'both loops measured, within bounds, proof gate clear' };
}

// --------------------------------------------------------------------- admit

function admit(action, obs) {
  const evidence = [
    `observed ${obs.at}`,
    `direct=${obs.heldout.baseline} controlled=${obs.heldout.controlled}`,
    `gate_missing=${obs.heldout.gate_missing.join('|') || 'none'}`,
    `dogfood_rejected=${obs.dogfood.rejected_as_unknown}`,
  ];
  const common = {
    rollback: GOAL.rollback,
    evidence,
    claim_boundary: GOAL.claim_boundary,
    ttl_ms: 30 * 1000,
  };
  if (action.kind === 'repair_direct') {
    return createAdmission({ ...common, allowed_paths: action.targets, allowed_ops: ['fs.write'] });
  }
  if (action.kind === 'escalate') {
    return createAdmission({ ...common, allowed_paths: [ESCALATION, LEDGER], allowed_ops: ['fs.write'] });
  }
  return null; // measure and hold write nothing outside runs/
}

// ----------------------------------------------------------------------- run

function executeLoop(loop) {
  const dogfood = path.join(runsDirPath('dogfood'), 'run.js');
  if (loop === 'dogfood') {
    if (!fs.existsSync(directorFor())) throw new Error(`missing runner: ${directorFor()}`);
    const res = spawnSync(process.execPath, [dogfood], { cwd: ROOT, encoding: 'utf8', timeout: 240000, shell: false });
    return { loop, exit: res.status, stderr: (res.stderr || '').slice(-1500) };
  }
  const res = spawnSync(process.execPath, ['agent-os', 'improve', '--cycles', String(LIMITS.max_cycles), '--state', IMPROVE_STATE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 240000,
    shell: false,
  });
  return { loop, exit: res.status, stderr: (res.stderr || '').slice(-1500) };
}

function runsDirPath() {
  return path.join(ROOT, 'runs/monitor_workspace');
}
function directorFor() {
  return path.join(runsDirPath(), 'dogfood/run.js');
}

function appendLedger(entry) {
  fs.mkdirSync(path.dirname(path.join(ROOT, LEDGER)), { recursive: true });
  fs.appendFileSync(path.join(ROOT, LEDGER), JSON.stringify({ ...entry, hash: hash(entry) }) + '\n');
}

function step({ dryRun = false } = {}) {
  const obs = observe();
  const action = selectAction(obs);
  const record = { goal: GOAL.id, at: obs.at, action, observation: obs };
  if (dryRun) return { ...record, dry_run: true };

  if (action.kind === 'repair_direct') {
    const token = admit(action, obs);
    const relative = path.relative(ROOT, DIRECTOR);
    const receipt = writeFileWithAdmission(token, relative, directorSource(), { cwd: ROOT });
    appendLedger({ ...record, effect: 'wrote', target: relative, receipt: receipt.after_sha256 });
    return { ...record, wrote: relative, receipt };
  }
  if (action.kind === 'run_measure') {
    const result = executeLoop(action.loop);
    appendLedger({ ...record, effect: 'ran', exit: result.exit });
    return { ...record, ran: result };
  }
  if (action.kind === 'escalate') {
    const token = admit(action, obs);
    const receipt = writeFileWithAdmission(token, ESCALATION, JSON.stringify({ ...record, escalated: true }, null, 2), { cwd: ROOT });
    appendLedger({ ...record, effect: 'escalated' });
    return { ...record, escalated: true, receipt };
  }
  appendLedger({ ...record, effect: 'hold' });
  return { ...record, held: true };
}

module.exports = { GOAL, LIMITS, SCHEMA, admit, executeLoop, observe, score, selectAction, step };
