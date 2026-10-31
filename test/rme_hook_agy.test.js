'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { admitStance, admitWithToken, aov1Canonical, handleAgyHook, holdStance, protectedShellReason, readStanceState, verifyAdmitToken, writeStanceState } = require('../src/rme_hook');

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rme-hook-agy-test-')));
try {
  const statePath = path.join(dir, 'state.json');
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });

  const opts = { statePath, receiptDir: path.join(dir, 'hooks') };

  // 0a. FAIL-CLOSED default: fresh state, real Antigravity-shaped edit_file WITHOUT contractCheck -> deny
  const r0a = handleAgyHook('PreToolUse', {
    conversationId: 'agy-live-shape',
    toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } },
  }, opts);
  assert.equal(r0a.decision, 'deny');
  assert.match(r0a.reason, /Active stance is 'theorising'/);

  // 0b. Other real Antigravity write tools are gated too
  for (const name of ['write_to_file', 'replace_file_content', 'multi_replace_file_content']) {
    const r = handleAgyHook('PreToolUse', { toolCall: { name, args: { TargetFile: path.join(dir, 'any.js') } } }, opts);
    assert.equal(r.decision, 'deny', name);
  }

  // 0c. Prompt phrases can no longer open the gate (old EXEC_STANCE_PATTERN auto-open removed)
  handleAgyHook('PreInvocation', { prompt: 'proceed, fix it, inject, do it, build it' }, opts);
  const r0c = handleAgyHook('PreToolUse', { toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } } }, opts);
  assert.equal(r0c.decision, 'deny');

  // 0d. Legacy auto-opened state (admitWriteTools:true without explicit admitSource) is treated as closed
  writeStanceState(statePath, { stance: 'executing', admitWriteTools: true });
  const r0d = handleAgyHook('PreToolUse', { toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } } }, opts);
  assert.equal(r0d.decision, 'deny');

  // 0e. Proposer cannot run the admit CLI or edit the stance file itself
  const r0e = handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'node src/rme_hook.js --admit "x intent" "npm test"' } } }, opts);
  assert.equal(r0e.decision, 'deny');
  assert.match(r0e.reason, /operator-only/);

  // 1. AST delimiter rule on write_file (requires explicit operator admit now that default is fail-closed)
  admitStance(statePath, 'Agent OS hook fail-closed test', 'node test/rme_hook_agy.test.js');
  const bigFile = path.join(dir, 'big.js');
  fs.writeFileSync(bigFile, '// line\n'.repeat(65));
  const r1 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'write_file', args: { Path: bigFile, Overwrite: true } }
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r1.decision, 'deny');
  assert.match(r1.reason, /violates Invariant X_2/);

  // 2. Stance gate on edit_file
  writeStanceState(statePath, { stance: 'theorising', admitWriteTools: false, lastToolError: null });
  const r2 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } }
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r2.decision, 'deny');
  assert.match(r2.reason, /Active stance is 'theorising'/);

  // 3. Stance gate on mutating shell command
  const r3 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf ' + bigFile } }
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r3.decision, 'deny');
  assert.match(r3.reason, /Shell mutations are paused/);

  // 4. Unbounded search gate in executing stance
  admitStance(statePath, 'Agent OS hook fail-closed test', 'node test/rme_hook_agy.test.js');
  const r4 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'run_command', args: { CommandLine: 'find ' + '/Users/jobs' + ' -name codex' } }
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r4.decision, 'deny');
  assert.match(r4.reason, /Unbounded recursive search/);

  // 5. Redirection clobber on >60 line code file
  const r5 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'run_command', args: { CommandLine: 'cat << EOF > ' + bigFile } }
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r5.decision, 'deny');
  assert.match(r5.reason, /violates Invariant X_2/);

  // 6. Safe standard command admitted
  const r6 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'run_command', args: { CommandLine: 'node -v' } }
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r6.decision, 'allow');

  // 7. SessionStart generates dynamic inventory count and invariant laws in Turn-0 banner
  const r7 = handleAgyHook('SessionStart', {
    conversationId: 'test-session-inv',
    prompt: 'Resume Agent OS'
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(typeof r7.injectSteps?.[0]?.systemMessage?.systemMessage, 'string');
  assert.match(r7.injectSteps[0].systemMessage.systemMessage, /TURN-0 WORKING MEMORY \(M_0\)/);
  assert.match(r7.injectSteps[0].systemMessage.systemMessage, /ACTIVE_INVENTORY\.md \(\d+ verified assets, \d+ invariant laws\)/);

  // 7b. Even when admitted, an explicitly empty witness is held (no implicit 'exit 0' default)
  const r7b = handleAgyHook('PreToolUse', {
    toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } },
    witnessCriteria: '',
  }, opts);
  assert.equal(r7b.decision, 'deny');
  assert.match(r7b.reason, /CONTRACT_HOLD/);

  // 8. Invariant X_11 contract gate holds unanchored mutating actions
  const r8 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } },
    contractCheck: true,
    teleologicalIntent: '',
    witnessCriteria: 'npm test'
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r8.decision, 'deny');
  assert.match(r8.reason, /CONTRACT_HOLD/);

  // 9. Invariant X_11 contract gate admits properly anchored mutating actions
  const r9 = handleAgyHook('PreToolUse', {
    toolCall: { name: 'edit_file', args: { Path: path.join(dir, 'any.js') } },
    contractCheck: true,
    teleologicalIntent: 'Refactor symbol to respect bounds',
    witnessCriteria: 'exit 0'
  }, { statePath, receiptDir: path.join(dir, 'hooks') });
  assert.equal(r9.decision, 'allow');

  // ---- 10+. aov1 HMAC admit token (external verifier ~/.agent_oracle scheme) ----
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  const head = git('rev-parse', 'HEAD');
  const keyPath = path.join(dir, 'test-verifier.key');
  const testKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyPath, testKey + '\n', { mode: 0o400 });
  const admitVerify = { keyPath, repoRoot: repo, env: {} };
  const tOpts = { ...opts, admitVerify };
  const mint = (overrides = {}, key = testKey) => {
    const t = { status: 'ADMITTED', version: 'aov1', baseSha: head, patchHash: crypto.randomBytes(32).toString('hex'),
      oracleFingerprint: crypto.randomBytes(32).toString('hex'), timestamp: new Date().toISOString(), touchedFiles: ['src/a.js', 'src/b.js'], ...overrides };
    t.signature = t.signature || crypto.createHmac('sha256', key).update(aov1Canonical(t), 'utf8').digest('hex');
    t.id = t.signature.slice(0, 16);
    return t;
  };
  const tokenFile = (t, name) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(t)); return f; };
  const editAny = { toolCall: { name: 'edit_file', args: { Path: path.join(repo, 'a.txt') } } };

  // 10. Valid HMAC token admits: stance executing, source hmac_token, edit allowed
  holdStance(statePath);
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'deny');
  const good = mint();
  const admitted = admitWithToken(statePath, tokenFile(good, 'good.json'), admitVerify);
  assert.equal(admitted.stance, 'executing');
  assert.equal(admitted.admitSource, 'hmac_token');
  assert.equal(readStanceState(statePath, admitVerify).admitWriteTools, true);
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'allow');
  // 10b. Single-use: same token cannot be replayed after a hold
  holdStance(statePath);
  assert.throws(() => admitWithToken(statePath, path.join(dir, 'good.json'), admitVerify), /token_already_consumed/);
  // 10c. JSONL ledger input: last aov1 ADMITTED line is used
  const ledgerTok = mint();
  const ledger = path.join(dir, 'ledger.jsonl');
  fs.writeFileSync(ledger, [JSON.stringify({ status: 'REJECTED', reason: 'x' }), JSON.stringify(ledgerTok), JSON.stringify({ status: 'REJECTED' })].join('\n') + '\n');
  assert.equal(admitWithToken(statePath, ledger, admitVerify).admitToken.signature, ledgerTok.signature);
  holdStance(statePath);

  // 11. Forged signature denies (wrong key, and tampered field)
  assert.throws(() => admitWithToken(statePath, tokenFile(mint({}, 'not-the-key'), 'forged.json'), admitVerify), /token_signature_invalid/);
  const tampered = mint(); tampered.touchedFiles = ['src/a.js', 'src/evil.js'];
  assert.throws(() => admitWithToken(statePath, tokenFile(tampered, 'tampered.json'), admitVerify), /token_signature_invalid/);
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'deny');
  // 11b. Hand-written stance claiming hmac_token with a forged token is closed on read
  writeStanceState(statePath, { stance: 'executing', admitWriteTools: true, admitSource: 'hmac_token', admitToken: mint({}, 'forged-key') });
  assert.equal(readStanceState(statePath, admitVerify).admitWriteTools, false);
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'deny');
  // 11c. Expired (>1h), wrong baseSha, unsorted files, missing version all rejected
  assert.equal(verifyAdmitToken(mint({ timestamp: new Date(Date.now() - 61 * 60 * 1000).toISOString() }), admitVerify).reason, 'token_expired');
  assert.equal(verifyAdmitToken(mint({ baseSha: 'f'.repeat(40) }), admitVerify).reason, 'token_baseSha_not_HEAD');
  assert.equal(verifyAdmitToken(mint({ touchedFiles: ['z', 'a'] }), admitVerify).reason, 'token_touchedFiles_not_sorted_deduped');
  const noVer = mint(); delete noVer.version;
  assert.equal(verifyAdmitToken(noVer, admitVerify).reason, 'token_version_not_aov1');
  // 11d. Admit closes automatically once HEAD moves off baseSha
  admitWithToken(statePath, tokenFile(mint(), 'good2.json'), admitVerify);
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'allow');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'move');
  assert.equal(readStanceState(statePath, admitVerify).admitClosedReason, 'token_baseSha_not_HEAD');
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'deny');
  // 11e. Real verifier key (if readable as this uid): mint + verify without ever printing it
  const realKeyPath = path.join(os.homedir(), '.agent_oracle', 'secrets', 'verifier.key');
  let realKey = null;
  try { realKey = fs.readFileSync(realKeyPath, 'utf8').trim(); } catch {}
  if (realKey) {
    const realTok = mint({ baseSha: git('rev-parse', 'HEAD') }, realKey);
    assert.equal(verifyAdmitToken(realTok, { repoRoot: repo }).ok, true);
    assert.equal(verifyAdmitToken(mint({ baseSha: git('rev-parse', 'HEAD') }, realKey + 'x'), { repoRoot: repo }).reason, 'token_signature_invalid');
  }
  realKey = null;

  // 12. Protected paths are always denied, even while admitted
  admitWithToken(statePath, tokenFile(mint({ baseSha: git('rev-parse', 'HEAD') }), 'good3.json'), admitVerify);
  assert.equal(handleAgyHook('PreToolUse', editAny, tOpts).decision, 'allow');
  const deny = (input, re) => { const r = handleAgyHook('PreToolUse', input, tOpts); assert.equal(r.decision, 'deny', JSON.stringify(input)); if (re) assert.match(r.reason, re); };
  deny({ toolCall: { name: 'write_to_file', args: { TargetFile: path.join(repo, '.agents', 'hooks.json') } } }, /protected control paths/);
  deny({ toolCall: { name: 'edit_file', args: { Path: path.join(os.homedir(), '.gemini', 'settings.json') } } }, /protected control paths/);
  deny({ toolCall: { name: 'edit_file', args: { Path: path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js') } } }, /protected control paths/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'echo {} > .agents/hooks.json' } } }, /protected control paths/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'cat ~/.agent_oracle/secrets/verifier.key' } } }, /verifier secret/);
  deny({ toolCall: { name: 'view_file', args: { AbsolutePath: path.join(os.homedir(), '.agent_oracle', 'secrets', 'verifier.key') } } }, /verifier secret/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'node src/rme_hook.js --admit-token /tmp/t.json' } } }, /operator-only/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'node -e "require(\'./src/rme_hook\').admitWithToken(1,2)"' } } }, /operator-only/);
  // Read-only inspection and the sanctioned verifier submission stay allowed
  assert.equal(handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'cat .agents/hooks.json' } } }, tOpts).decision, 'allow');
  assert.equal(handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: `node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch /tmp/c.patch` } } }, tOpts).decision, 'allow');
  // Quoted --repo/--patch with spaces (workspace is "New project") is the sanctioned form, not a false deny
  assert.equal(handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: `node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch /tmp/c.patch --repo "/Users/jobs/Documents/New project"` } } }, tOpts).decision, 'allow');
  assert.equal(handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: `node "${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')}" --patch "/tmp/my patch.patch" --repo "/Users/jobs/Documents/New project" --dry-run` } } }, tOpts).decision, 'allow');
  assert.equal(protectedShellReason(`node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch /tmp/c.patch --repo "/Users/jobs/Documents/New project"`), null);
  // Quoting must not open chaining/expansion holes
  deny({ toolCall: { name: 'run_command', args: { CommandLine: `node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch /tmp/c.patch --repo "/x; rm -rf ~/.agent_oracle"` } } }, /protected_path_shell/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: `node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch "$(touch ~/.agent_oracle/x)" --repo "/Users/jobs/Documents/New project"` } } }, /protected_path_shell/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: `node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch /tmp/c.patch --repo "/Users/jobs/Documents/New project" && echo x > ~/.agent_oracle/y` } } }, /protected_path_shell/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: `node ${path.join(os.homedir(), '.agent_oracle', 'bin', 'verify_and_admit.js')} --patch /tmp/c.patch --repo "/Users/jobs/Documents/New project" --commit` } } }, /protected_path_shell/);
  // Antigravity per-conversation artifact dir under ~/.gemini stays writable
  const agyArtifacts = path.join(os.homedir(), '.gemini', 'antigravity', 'brain', 'test-conv-1');
  assert.equal(handleAgyHook('PreToolUse', { artifactDirectoryPath: agyArtifacts, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(agyArtifacts, 'task.md') } } }, tOpts).decision, 'allow');
  deny({ artifactDirectoryPath: agyArtifacts, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(agyArtifacts, '.system_generated', 'x') } } });
  // Hook self-protection: its own source + this test are never writable, even while admitted
  const hookSrc = path.join(__dirname, '..', 'src', 'rme_hook.js');
  deny({ toolCall: { name: 'edit_file', args: { Path: hookSrc } } }, /protected control paths.*hook_self/);
  deny({ toolCall: { name: 'write_to_file', args: { TargetFile: path.join(__dirname, 'rme_hook_agy.test.js') } } }, /hook_self/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'sed -i s/deny/allow/ src/rme_hook.js' } } }, /hook_self_shell/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'echo x > src/rme_hook.js' } } }, /hook_self_shell/);
  deny({ toolCall: { name: 'run_command', args: { CommandLine: 'git checkout -- test/rme_hook_agy.test.js' } } }, /hook_self_shell/);
  assert.equal(handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'cat src/rme_hook.js' } } }, tOpts).decision, 'allow');
  assert.equal(handleAgyHook('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'node test/rme_hook_agy.test.js' } } }, tOpts).decision, 'allow');
  holdStance(statePath);

  // 13. CLI: forged token file is rejected with exit 2 (no state written on reject)
  const cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'rme_hook.js'), '--admit-token', path.join(dir, 'forged.json')], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /admit-token rejected/);

  console.log('PASS: aov1 HMAC admit token (valid admits, forged/expired/stale denied, single-use, re-verified on read); protected paths always denied');
  console.log('PASS: handleAgyHook fail-closed by default; pre-tool gates enforce stance, AST delimiter, shell safety, dynamic invariant banners, and X_11 contract gating');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
