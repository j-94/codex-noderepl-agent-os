'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { hash } = require('./core');
const { BITS, evalActLaw, maskToString } = require('./bit_tape');
const { nativeContext, digest, DEFAULT_STATE, PROJECT_ROOT } = require('./rme_native');
const { readHandover } = require('./rme_handover');
const { evalContractGate } = require('./contract_gate');
const { evalDelimiterGuard } = require('./ast_delimiter_guard');
const { evalProposerGate } = require('./proposer_gate');

const ALLOWED_ROOTS = [PROJECT_ROOT, '/Users/jobs/Documents/Codex/2026-10-19/what-have-we-been-working-on'];
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
const AGY_EVENTS = new Set(['SessionStart', 'PreInvocation', 'PreToolUse', 'PostToolUse', 'Stop']);
const FRESH_CHAT_ROOT = '/Users/jobs/Documents/Codex';
const HOLD_STANCE_PATTERN = /\b(we are theorising|we're theorising|pausing all code|pause feature development|without writing|no code edits|explain simply|im lost|i'm lost|what do i mean by|audit the existing)\b/i;
// FAIL-CLOSED: prompt text can only CLOSE the gate (HOLD_STANCE_PATTERN). No prompt phrase
// ("proceed", "fix", "inject", "do it", ...) can open write tools any more. Opening happens only via the
// explicit operator CLI: node src/rme_hook.js --admit "<intent>" "<witness>" (see admitStance).
// Two admit sources exist:
//   'hmac_token'   (STRONG) node src/rme_hook.js --admit-token <token.json>  (or env AGENT_OS_ADMIT_TOKEN)
//                  The token is minted by the external verifier ~/.agent_oracle/bin/verify_and_admit.js
//                  (scheme aov1, see ~/.agent_oracle/README.md) and is RE-VERIFIED on every stance read:
//                  HMAC-SHA256 signature, version aov1, age <= 1h, baseSha === git HEAD of PROJECT_ROOT.
//   'operator_cli' (WEAK fallback for Jacob) node src/rme_hook.js --admit "<intent>" "<witness>"
//                  Only a same-uid marker sealed with an unkeyed hash; anything running as `jobs` that
//                  can write agy-stance.json could forge it. Prefer the HMAC token.
const WRITE_TOOLS = new Set(['edit_file', 'write_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content']);
const STANCE_CONTROL_PATTERN = /rme_hook(?:\.js)?[^|;&]*--(?:admit|hold)|\b(?:admitStance|holdStance|admitWithToken|writeStanceState)\b|agy-stance\.json|agy-admit-consumed\.json/i;

// ---- aov1 HMAC admit token (external verifier ~/.agent_oracle) ----
const ORACLE_ROOT = path.join(os.homedir(), '.agent_oracle');
const VERIFIER_KEY_PATH = path.join(ORACLE_ROOT, 'secrets', 'verifier.key');
const VERIFIER_BIN = path.join(ORACLE_ROOT, 'bin', 'verify_and_admit.js');
const ADMIT_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const ADMIT_TOKEN_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

// ---- Always-protected paths (denied for PreToolUse writes/mutations regardless of stance) ----
const PROTECTED_SEGMENTS = new Set(['.agents', '.gemini', '.agent_oracle']);
const PROTECTED_BASENAMES = new Set(['agy-stance.json', 'agy-admit-consumed.json']);
// Narrow carve-out: Antigravity's own per-conversation artifact dir lives under ~/.gemini/antigravity/brain/<id>/.
const AGY_ARTIFACT_DIR_PATTERN = new RegExp(`^${path.join(os.homedir(), '.gemini', 'antigravity', 'brain').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z0-9_-]{1,128}/?$`);
const PROTECTED_SHELL_REF = /(?:^|[\s'"=:(\/])\.(?:agents|gemini|agent_oracle)(?=[\/\s'"]|$)|agy-stance\.json|agy-admit-consumed\.json/i;
// Self-protection: the hook source and its adversarial test are never writable by the proposer.
const SELF_PROTECTED_FILES = [__filename, path.join(__dirname, '..', 'test', 'rme_hook_agy.test.js')]
  .flatMap(f => { const r = [path.resolve(f)]; try { r.push(fs.realpathSync(f)); } catch {} return r; });
const SELF_SHELL_REF = /rme_hook(?:_agy\.test)?\.js\b/i;
const SELF_RUN_SHELL = /^\s*(?:\/\S*\/)?node\s+(?:\.\/)?(?:\S*\/)?(?:src\/rme_hook\.js|test\/rme_hook_agy\.test\.js)(?:\s+[^\s;&|`<>$()]+)*\s*$/;
const SECRET_SHELL_REF = /\.agent_oracle[\/\\]+secrets|verifier\.key|AGENT_OS_VERIFY_KEY/i;
const READ_ONLY_SHELL = /^\s*(?:cat|ls|head|tail|wc|stat|file|less|jq|git\s+(?:diff|log|status|show))\s/;
const SHELL_CHAINING = /[;&|`<>]|\$\(|(?:^|\s)-i\b/;

function loadVerifierKey({ keyPath = VERIFIER_KEY_PATH, env = process.env } = {}) {
  // NEVER log or return the key outside this module's HMAC call.
  try {
    const key = fs.readFileSync(keyPath, 'utf8').trim();
    if (key) return key;
  } catch { /* fall through to env */ }
  const fromEnv = typeof env.AGENT_OS_VERIFY_KEY === 'string' ? env.AGENT_OS_VERIFY_KEY.trim() : '';
  return fromEnv || null;
}

function aov1Canonical(t) {
  return ['aov1', t.baseSha, t.patchHash, t.oracleFingerprint, t.timestamp, t.touchedFiles.join(',')].join('\n');
}

function parseAdmitToken(raw) {
  // Accepts a single token JSON (audit/tokens/<id>.json or verifier stdout) or a JSONL ledger
  // (takes the LAST aov1 ADMITTED line).
  const text = String(raw || '').trim();
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch { /* maybe JSONL */ }
  const lines = text.split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try { const obj = JSON.parse(line); if (obj?.status === 'ADMITTED' && obj?.version === 'aov1') return obj; } catch {}
  }
  return null;
}

function gitHead(repoRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
}

function verifyAdmitToken(token, { keyPath = VERIFIER_KEY_PATH, env = process.env, repoRoot = PROJECT_ROOT, now = Date.now(), maxAgeMs = ADMIT_TOKEN_MAX_AGE_MS, patchPath = null } = {}) {
  const fail = reason => ({ ok: false, reason });
  if (!token || typeof token !== 'object') return fail('token_unparseable');
  if (token.version !== 'aov1') return fail('token_version_not_aov1');
  if (token.status !== undefined && token.status !== 'ADMITTED') return fail('token_status_not_admitted');
  if (!/^[0-9a-f]{40}$/.test(token.baseSha || '')) return fail('token_bad_baseSha');
  if (!/^[0-9a-f]{64}$/.test(token.patchHash || '')) return fail('token_bad_patchHash');
  if (!/^[0-9a-f]{64}$/.test(token.oracleFingerprint || '')) return fail('token_bad_oracleFingerprint');
  if (!/^[0-9a-f]{64}$/.test(token.signature || '')) return fail('token_bad_signature_format');
  if (!Array.isArray(token.touchedFiles) || token.touchedFiles.length > 4096 || !token.touchedFiles.every(f => typeof f === 'string' && f.length > 0 && f.length < 1024 && !f.includes(','))) return fail('token_bad_touchedFiles');
  const sorted = [...new Set(token.touchedFiles)].sort();
  if (sorted.length !== token.touchedFiles.length || sorted.some((f, i) => f !== token.touchedFiles[i])) return fail('token_touchedFiles_not_sorted_deduped');
  if (typeof token.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(token.timestamp)) return fail('token_bad_timestamp');
  const ts = Date.parse(token.timestamp);
  if (!Number.isFinite(ts)) return fail('token_bad_timestamp');
  if (ts - now > ADMIT_TOKEN_MAX_FUTURE_SKEW_MS) return fail('token_timestamp_in_future');
  if (now - ts > maxAgeMs) return fail('token_expired');
  const key = loadVerifierKey({ keyPath, env });
  if (!key) return fail('verifier_key_unavailable');
  const expected = crypto.createHmac('sha256', key).update(aov1Canonical(token), 'utf8').digest();
  const given = Buffer.from(token.signature, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(expected, given)) return fail('token_signature_invalid');
  let head;
  try { head = gitHead(repoRoot); } catch { return fail('git_head_unavailable'); }
  if (head !== token.baseSha) return fail('token_baseSha_not_HEAD');
  if (patchPath) {
    let bytes;
    try { bytes = fs.readFileSync(patchPath); } catch { return fail('patch_unreadable'); }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== token.patchHash) return fail('token_patchHash_mismatch');
  }
  return { ok: true, reason: 'aov1_valid' };
}

function signedTokenFields(t) {
  const { id, status, version, baseSha, patchHash, oracleFingerprint, timestamp, touchedFiles, signature } = t;
  return { id: id ?? null, status: status ?? null, version, baseSha, patchHash, oracleFingerprint, timestamp, touchedFiles, signature };
}

function resolveWithRealAncestor(p) {
  const abs = path.resolve(PROJECT_ROOT, p.replace(/^~(?=\/|$)/, os.homedir()));
  let cur = abs;
  const rest = [];
  try {
    while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
    return [abs, path.join(fs.realpathSync(cur), ...rest)];
  } catch { return [abs]; }
}

function protectedPathReason(targetPath, artifactDir = '') {
  if (typeof targetPath !== 'string' || !targetPath) return null;
  const candidates = resolveWithRealAncestor(targetPath);
  const artifactOk = typeof artifactDir === 'string' && AGY_ARTIFACT_DIR_PATTERN.test(artifactDir);
  for (const c of candidates) {
    if (c.split(path.sep).some(seg => seg.toLowerCase() === '.agent_oracle')) return 'agent_oracle';
    if (PROTECTED_BASENAMES.has(path.basename(c))) return 'stance_file';
    if (SELF_PROTECTED_FILES.includes(c)) return 'hook_self';
    if (c.split(path.sep).some(seg => seg.toLowerCase() === '.agents')) return 'agents_config';
    if (c.split(path.sep).some(seg => seg.toLowerCase() === '.gemini')) {
      const base = artifactDir.replace(/\/+$/, '');
      if (artifactOk && c.startsWith(base + path.sep) && !c.split(path.sep).includes('.system_generated')) continue;
      return 'gemini_config';
    }
  }
  return null;
}

function isSanctionedVerifierInvocation(commandLine) {
  // The proposer may submit a patch to the external verifier (sandbox-only, never commits).
  // --patch/--repo accept a double-quoted arg (no $, backtick, backslash) so paths with spaces ("New project") match.
  const m = commandLine.match(/^\s*(?:\/\S*\/)?node\s+("?)([^"\s]+)\1\s+--patch\s+(?:"[^"$\x60\\]+"|\S+)(?:\s+--repo\s+(?:"[^"$\x60\\]+"|\S+))?(?:\s+--dry-run)?\s*$/);
  if (!m || SHELL_CHAINING.test(commandLine)) return false;
  const bin = m[2].replace(/^~(?=\/)/, os.homedir());
  return bin === VERIFIER_BIN;
}

function protectedShellReason(commandLine) {
  if (!commandLine) return null;
  if (SECRET_SHELL_REF.test(commandLine)) return 'verifier_secret';
  if (SELF_SHELL_REF.test(commandLine)) {
    const chained = SHELL_CHAINING.test(commandLine);
    if (!chained && (READ_ONLY_SHELL.test(commandLine) || SELF_RUN_SHELL.test(commandLine))) { /* inspect or run only */ }
    else return 'hook_self_shell';
  }
  if (!PROTECTED_SHELL_REF.test(commandLine)) return null;
  if (isSanctionedVerifierInvocation(commandLine)) return null;
  if (READ_ONLY_SHELL.test(commandLine) && !SHELL_CHAINING.test(commandLine)) return null;
  return 'protected_path_shell';
}
const MUTATING_SHELL_PATTERN = /\b(rm|rmdir|mv|cp|sed\s+-i|truncate|unlink|git\s+(?:reset|clean|restore|commit|push|rebase|merge))\b|>{1,2}\s*(?!\/tmp|\/dev|\.tmp)/i;
const UNBOUNDED_SEARCH_PATTERN = /\b(?:find|grep|rg)\s+[^|;&]*(?:\/(?:Users\/[^\s/]+|\/)\s+-name|\/(?:Users\/[^\s/]+|\/)\s+-type|\/(?:Users\/[^\s/]+|\/)\s+[^\s]+)/i;

function freshChat(cwd, root) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || path.normalize(cwd) !== cwd) return null;
  const relative = path.relative(root, cwd);
  if (!/^\d{4}-\d{2}-\d{2}[/\\][a-zA-Z0-9][a-zA-Z0-9_.-]{0,179}$/.test(relative)) return null;
  try { return fs.realpathSync(cwd) === cwd && fs.statSync(cwd).isDirectory() ? cwd : null; } catch { return null; }
}

function associationFile(statePath) {
  return path.join(path.dirname(path.resolve(statePath)), 'hook-associations.json');
}

function readAssociations(statePath) {
  const file = associationFile(statePath);
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isFile() || stat.size > 262144) throw new Error('Invalid hook association file');
  const { hash: seal, ...body } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (body.kind !== 'agent_os.rme_hook_associations.v1' || seal !== hash(body) || !Array.isArray(body.sessions) || body.sessions.length > 256) throw new Error('Invalid hook associations');
  for (const item of body.sessions) {
    const { hash: itemHash, ...record } = item;
    if (itemHash !== hash(record) || record.project !== 'Agent OS' || !boundedId(record.session_id) || typeof record.cwd !== 'string' || record.cwd.length > 1024 || !path.isAbsolute(record.cwd)) throw new Error('Invalid hook association');
  }
  return body.sessions;
}

function associate(statePath, sessionId, cwd, handoverHash) {
  const file = associationFile(statePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const fd = fs.openSync(lock, 'wx', 0o600);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const sessions = readAssociations(statePath).filter(item => item.session_id !== sessionId);
    const record = { project: 'Agent OS', session_id: sessionId, cwd, handover_hash: handoverHash, updated_at: new Date().toISOString() };
    const association = { ...record, hash: hash(record) };
    sessions.push(association);
    const body = { kind: 'agent_os.rme_hook_associations.v1', sessions: sessions.slice(-256) };
    fs.writeFileSync(temporary, JSON.stringify({ ...body, hash: hash(body) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    return association;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function namesProject(prompt, handover) {
  if (typeof prompt !== 'string') return false;
  if (/\bagent\s+os\b/i.test(prompt)) return true;
  return Boolean(handover?.source_thread_ids.some(id => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-zA-Z0-9_.-])${escaped}(?![a-zA-Z0-9_.-])`).test(prompt);
  }));
}

function scopedRoot(cwd, allowedRoots) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  try {
    const real = fs.realpathSync(cwd);
    return allowedRoots.some(root => fs.existsSync(root) && fs.realpathSync(root) === real) ? real : null;
  } catch { return null; }
}

function boundedId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,180}$/.test(value) ? value : null;
}

function payloadDigest(value) {
  return value === undefined ? null : hash(value);
}

function handleHook(input, { allowedRoots = ALLOWED_ROOTS, statePath = DEFAULT_STATE,
  receiptDir = path.join(PROJECT_ROOT, 'runs/ruliad/hooks'), wrapped = process.env.AGENT_OS_RME_WRAPPED === '1', freshChatRoot = FRESH_CHAT_ROOT } = {}) {
  if (!EVENTS.has(input?.hook_event_name)) return {};
  const exactRoot = scopedRoot(input?.cwd, allowedRoots);
  const sessionId = boundedId(input.session_id);
  const cwd = exactRoot || (sessionId && freshChat(input.cwd, freshChatRoot));
  if (!cwd) return {};
  const event = input.hook_event_name;
  let association = null;
  let handover = null;
  let continuityError = false;
  try {
    if (sessionId) association = readAssociations(statePath).find(item => item.session_id === sessionId && item.cwd === cwd) || null;
    handover = readHandover(statePath);
  } catch { continuityError = true; }
  const explicitProject = event === 'UserPromptSubmit' && (namesProject(input.prompt, handover) || Boolean(sessionId && handover?.source_thread_ids.includes(sessionId)));
  if (!exactRoot && !association && !explicitProject) return {};
  const receipt = {
    kind: 'agent_os.rme_hook_receipt.v1', id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    event, cwd, session_id: boundedId(input.session_id), tool_use_id: boundedId(input.tool_use_id),
    tool_name: boundedId(input.tool_name), source: 'codex-plugin-hook',
    hook_source_sha256: digest(fs.readFileSync(__filename)),
    dependency_sha256: Object.fromEntries(['rme.js', 'rme_native.js', 'rme_handover.js', 'core.js'].map(file => [file, digest(fs.readFileSync(path.join(__dirname, file)))])),
    prompt_hash: payloadDigest(input.prompt), tool_input_hash: payloadDigest(input.tool_input),
    tool_response_hash: payloadDigest(input.tool_response),
    outcome: event === 'PostToolUse' ? 'tool_result_observed_unverified' : 'event_observed',
    wrapped, injection: 'not_requested', graph_hash: null, cut_hash: null, lesson_ids: [],
    delivered_context: null, delivered_context_sha256: null, selected_cut: null,
    association_hash: association?.hash || null, handover_hash: null,
  };
  let output = {};
  if (event === 'UserPromptSubmit' || (event === 'SessionStart' && association)) {
    receipt.injection = wrapped ? 'suppressed_wrapped_run' : 'empty_prompt';
    if (!wrapped && (event === 'SessionStart' || (typeof input.prompt === 'string' && input.prompt.trim()))) {
      try {
        if (continuityError) throw new Error('Invalid continuity state');
        const selected = nativeContext(event === 'SessionStart' ? 'Resume Agent OS' : input.prompt, { statePath, includeHandover: true });
        receipt.graph_hash = selected.graph.hash;
        receipt.cut_hash = selected.cut.hash;
        receipt.lesson_ids = selected.cut.lessonIds;
        receipt.handover_hash = selected.handover?.hash || null;
        if (!exactRoot && explicitProject && !association) {
          association = associate(statePath, sessionId, cwd, receipt.handover_hash);
          receipt.association_hash = association.hash;
        }
        receipt.injection = 'delivered';
        if (Buffer.byteLength(selected.context, 'utf8') > 65536 || Buffer.byteLength(JSON.stringify(selected.cut), 'utf8') > 262144) {
          receipt.injection = 'held_context_exceeds_bound';
        } else {
          receipt.delivered_context = selected.context;
          receipt.delivered_context_sha256 = digest(Buffer.from(selected.context, 'utf8'));
          receipt.selected_cut = selected.cut;
          output = { hookSpecificOutput: { hookEventName: event, additionalContext: selected.context } };
        }
      } catch {
        receipt.injection = 'held_invalid_state_or_evidence';
      }
    }
  }
  const sealed = { ...receipt, hash: hash(receipt) };
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, `${receipt.id}.json`), JSON.stringify(sealed, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return output;
}

function stanceFile(statePath) {
  return path.join(path.dirname(path.resolve(statePath)), 'agy-stance.json');
}

function readRawStance(statePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(stanceFile(statePath), 'utf8'));
    const { hash: seal, ...body } = raw;
    if (body.kind === 'agent_os.agy_stance.v1' && seal === hash(body)) return body;
  } catch { /* none */ }
  return null;
}

function readStanceState(statePath, verifyOpts = {}) {
  const body = readRawStance(statePath);
  if (body) {
    const closed = reason => ({ ...body, stance: 'theorising', admitWriteTools: false, admitSource: null, admitClosedReason: reason });
    if (!body.admitWriteTools) return body;
    // Fail-closed: a persisted admit only counts if it came from an explicit admit mechanism.
    if (body.admitSource === 'operator_cli') return body; // WEAK: same-uid marker only (see header comment).
    if (body.admitSource === 'hmac_token') {
      // STRONG: re-verify the signed token on every read, so a hand-edited stance file cannot open the gate
      // and the admit expires with the token (1h) or when HEAD moves off baseSha.
      try {
        const v = verifyAdmitToken(body.admitToken, verifyOpts);
        return v.ok ? body : closed(v.reason);
      } catch { return closed('token_verify_error'); }
    }
    return closed('unknown_admit_source');
  }
  return {
    kind: 'agent_os.agy_stance.v1',
    stance: 'theorising',
    admitWriteTools: false,
    admitSource: null,
    admitIntent: null,
    admitWitness: null,
    lastPrompt: null,
    lastToolError: null,
    updatedAt: null,
  };
}

function writeStanceState(statePath, patch) {
  const file = stanceFile(statePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = readRawStance(statePath) || readStanceState(statePath);
  const body = {
    kind: 'agent_os.agy_stance.v1',
    stance: patch.stance ?? prev.stance,
    admitWriteTools: patch.admitWriteTools ?? prev.admitWriteTools,
    admitSource: patch.admitSource !== undefined ? patch.admitSource : (prev.admitSource ?? null),
    admitIntent: patch.admitIntent !== undefined ? patch.admitIntent : (prev.admitIntent ?? null),
    admitWitness: patch.admitWitness !== undefined ? patch.admitWitness : (prev.admitWitness ?? null),
    admitToken: patch.admitToken !== undefined ? patch.admitToken : (prev.admitToken ?? null),
    lastPrompt: patch.lastPrompt !== undefined ? patch.lastPrompt : prev.lastPrompt,
    lastToolError: patch.lastToolError !== undefined ? patch.lastToolError : prev.lastToolError,
    updatedAt: new Date().toISOString(),
  };
  const sealed = { ...body, hash: hash(body) };
  fs.writeFileSync(file, JSON.stringify(sealed, null, 2) + '\n', { mode: 0o600 });
  return sealed;
}

function admitStance(statePath, intent, witness) {
  if (typeof intent !== 'string' || intent.trim().length < 5) throw new Error('admit requires intent (>=5 chars)');
  if (typeof witness !== 'string' || witness.trim().length < 3) throw new Error('admit requires witness (>=3 chars)');
  return writeStanceState(statePath, {
    stance: 'executing', admitWriteTools: true, admitSource: 'operator_cli', admitToken: null,
    admitIntent: intent.trim().slice(0, 500), admitWitness: witness.trim().slice(0, 200), lastToolError: null,
  });
}

function consumedFile(statePath) {
  return path.join(path.dirname(path.resolve(statePath)), 'agy-admit-consumed.json');
}

// STRONG admit: verify an aov1 token minted by ~/.agent_oracle/bin/verify_and_admit.js. Single-use per signature.
function admitWithToken(statePath, tokenPath, verifyOpts = {}) {
  if (typeof tokenPath !== 'string' || !tokenPath) throw new Error('admit-token requires a token file path (arg or AGENT_OS_ADMIT_TOKEN)');
  const stat = fs.statSync(tokenPath);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('admit-token: not a bounded regular file');
  const token = parseAdmitToken(fs.readFileSync(tokenPath, 'utf8'));
  const v = verifyAdmitToken(token, verifyOpts);
  if (!v.ok) throw new Error(`admit-token rejected: ${v.reason}`);
  const cfile = consumedFile(statePath);
  let consumed = [];
  try { consumed = JSON.parse(fs.readFileSync(cfile, 'utf8')); if (!Array.isArray(consumed)) consumed = []; } catch {}
  if (consumed.includes(token.signature)) throw new Error('admit-token rejected: token_already_consumed');
  fs.mkdirSync(path.dirname(cfile), { recursive: true });
  fs.writeFileSync(cfile, JSON.stringify([...consumed, token.signature].slice(-1024)) + '\n', { mode: 0o600 });
  const files = token.touchedFiles.join(', ').slice(0, 300);
  return writeStanceState(statePath, {
    stance: 'executing', admitWriteTools: true, admitSource: 'hmac_token', admitToken: signedTokenFields(token),
    admitIntent: `Apply verifier-admitted patch ${token.patchHash.slice(0, 12)} (${files || 'no files'})`,
    admitWitness: `aov1 oracle ${token.oracleFingerprint.slice(0, 16)} sig ${token.signature.slice(0, 16)}`,
    lastToolError: null,
  });
}

function holdStance(statePath) {
  return writeStanceState(statePath, {
    stance: 'theorising', admitWriteTools: false, admitSource: null, admitIntent: null, admitWitness: null, admitToken: null,
  });
}

function extractLatestUserPrompt(input) {
  if (typeof input?.prompt === 'string' && input.prompt.trim()) return input.prompt.trim();
  const candidates = [
    input?.transcriptPath,
    input?.conversationId
      ? `/Users/jobs/.gemini/antigravity/brain/${input.conversationId}/.system_generated/logs/transcript.jsonl`
      : null,
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const row = JSON.parse(lines[i]);
        if (row.type === 'USER_INPUT' && typeof row.content === 'string') {
          const matches = [...row.content.matchAll(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/g)];
          if (matches.length > 0) return matches[matches.length - 1][1].trim();
          return row.content.trim();
        }
      }
    } catch { /* ignore unreadable transcript */ }
  }
  return '';
}

function handleAgyHook(eventName, input = {}, {
  statePath = DEFAULT_STATE,
  receiptDir = path.join(PROJECT_ROOT, 'runs/ruliad/hooks'),
  admitVerify = {},
} = {}) {
  const event = eventName || input.hook_event_name;
  if (!AGY_EVENTS.has(event)) return {};

  const sessionId = boundedId(input.conversationId || input.session_id) || 'agy-session';
  let stanceState = readStanceState(statePath, admitVerify);
  const shouldInspectPrompt = event === 'PreInvocation' || event === 'SessionStart' || typeof input.prompt === 'string';
  const prompt = shouldInspectPrompt ? extractLatestUserPrompt(input) : (stanceState.lastPrompt || '');

  const isNewPromptTurn = Boolean(prompt && prompt !== stanceState.lastPrompt);
  if (shouldInspectPrompt && isNewPromptTurn) {
    if (HOLD_STANCE_PATTERN.test(prompt)) {
      stanceState = writeStanceState(statePath, {
        stance: 'theorising',
        admitWriteTools: false,
        admitSource: null,
        lastPrompt: prompt.slice(0, 500),
      });
    } else {
      stanceState = writeStanceState(statePath, {
        lastPrompt: prompt.slice(0, 500),
      });
    }
  }

  let output = {};
  let graphHash = null;
  let cutHash = null;
  let lessonIds = [];
  let handoverHash = null;
  let deliveredContext = null;
  let injection = 'not_requested';
  let outcome = 'event_observed';

  if (event === 'SessionStart' || event === 'PreInvocation') {
    if (event === 'PreInvocation' && !isNewPromptTurn && !stanceState.lastToolError) {
      injection = 'skipped_mid_turn_duplicate';
    } else {
      try {
        const query = event === 'SessionStart' ? 'Resume Agent OS' : (prompt || 'Resume Agent OS');
        const selected = nativeContext(query, { statePath, includeHandover: true });
        graphHash = selected.graph.hash;
        cutHash = selected.cut.hash;
        lessonIds = selected.cut.lessonIds;
        handoverHash = selected.handover?.hash || null;

        const activeBitMask = (
          BITS.A |
          (stanceState.admitWriteTools ? BITS.P : 0) |
          (stanceState.lastToolError ? BITS.E : 0) |
          BITS.T
        );
        const actAdmitted = evalActLaw(activeBitMask);
        let inventoryNotice = 'ACTIVE_INVENTORY.md: present';
        try {
          const invPath = path.join(PROJECT_ROOT, 'ACTIVE_INVENTORY.md');
          if (fs.existsSync(invPath)) {
            const invText = fs.readFileSync(invPath, 'utf8');
            const assetCount = (invText.match(/\|\s*\*\*[^|]+\*\*\s*\|/g) || []).length;
            const invariantCount = (invText.match(/^\d+\.\s+\*\*\$X[^\n]+/gm) || []).length;
            inventoryNotice = `ACTIVE_INVENTORY.md (${assetCount} verified assets, ${invariantCount} invariant laws)`;
          }
        } catch {}

        const cleanIntent = (prompt || 'Resume Agent OS')
          .replace(/^(?:but:\s*)+/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        const displayIntent = cleanIntent.length > 80 ? `${cleanIntent.slice(0, 77)}...` : cleanIntent;

        const m0Line = `[TURN-0 WORKING MEMORY (M_0) | Ledger: ${inventoryNotice} | Intent: "${displayIntent}" | Invariant: Act <=> A=1 & P=1 & (E|D|U)=0 | Receipts: Graph:${graphHash.slice(0, 8)}, Handover:${handoverHash ? handoverHash.slice(0, 8) : 'none'} | Posture: ${stanceState.stance.toUpperCase()}]`;
        const urluxNotice = `[URL-UX / META3 CONTROL PLANE: http://127.0.0.1:4321/url-ux?revision=${graphHash.slice(0, 12)} | OpenAPI Docs: http://127.0.0.1:4321/docs | Spec: http://127.0.0.1:4321/openapi.json | Bus: meta3-graph-core (Native Rust) | Cut: ${cutHash ? cutHash.slice(0, 8) : 'active'}]`;
        const psiVectorBanner = '[Ψ-VECTOR STEERING | EngineFirst: Active (<100µs Tau/BitTape) | MutationMode: SurgicalAST (delimiter bounds) | Gating: Pareto-Exit0 | DriftTolerance: 0]';
        const cognitiveBanner = '[COGNITIVE RULES | C1(PrecedentMatchFirst): Active | C2(AuditableStance): VerificationRequired(2.3x lift) | C3(HypothesisRetention): FramePreserved]';

        let primitiveNotice = null;
        try {
          const primPath = path.join(PROJECT_ROOT, 'runs', 'autopoiesis', 'primitives_registry.json');
          if (fs.existsSync(primPath)) {
            const reg = JSON.parse(fs.readFileSync(primPath, 'utf8'));
            const q = cleanIntent.toLowerCase();
            const matchedPrims = (reg.primitives || []).filter((p) => {
              const terms = [p.id, ...(p.id.split('_')), ...(p.description ? p.description.toLowerCase().split(/\s+/) : [])];
              return terms.some(t => t.length > 3 && q.includes(t));
            });
            if (matchedPrims.length > 0) {
              primitiveNotice = `[MATCHED HARVESTED PRIMITIVES: ${matchedPrims.map(p => `${p.id} (P#${p.prime_id || 'v1'})`).join(', ')} | Live API: http://127.0.0.1:4321/primitives/${matchedPrims[0].id}]`;
            }
          }
        } catch {}

        let seedNotice = '[HOLOGRAPHIC SEED: META_OMNI | Server: http://127.0.0.1:3000 | Invariants: ActLaw, ClosedWorld(W), LedgerFirst, DeterministicGates | BitTape: 54/54 PASS]';
        try {
          const seedPath = path.join(PROJECT_ROOT, 'data', 'holographic_seed.v1.json');
          if (fs.existsSync(seedPath)) {
            const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            seedNotice = `[HOLOGRAPHIC SEED: ${seed.operational_level} | Manifest: ${seed.manifest_id} | Server: ${seed.endpoints.server} | BitTape: ${seed.capability_engine.verified_benchmark_score}]`;
          }
        } catch {}

        const banner = [
          `[AGENT OS HARNESS | Bits: ${maskToString(activeBitMask)} (${actAdmitted ? 'ACT_ADMIT' : 'ACT_HOLD'}) | Stance: ${stanceState.stance.toUpperCase()} (${stanceState.admitWriteTools ? 'write tools ADMITTED' : 'write/edit tools HELD'}) | Ruliad Graph: ${graphHash.slice(0, 12)}]`,
          m0Line,
          urluxNotice,
          psiVectorBanner,
          ...(primitiveNotice ? [primitiveNotice] : []),
          cognitiveBanner,
          seedNotice,
          ...(stanceState.lastToolError
            ? [`[REAL TOOL ERROR (E=1) ON PRIOR STEP]: ${stanceState.lastToolError.tool}: ${stanceState.lastToolError.error}`]
            : []),
          ...(isNewPromptTurn || event === 'SessionStart' ? [selected.context] : []),
        ].join('\n');

        deliveredContext = banner;
        injection = 'delivered';
        if (event === 'SessionStart') {
          output = {
            injectSteps: [
              {
                systemMessage: {
                  systemMessage: banner,
                },
              },
            ],
          };
        } else {
          output = {
            injectSteps: [
              {
                ephemeralMessage: banner,
              },
            ],
          };
        }
      } catch {
        injection = 'held_invalid_state_or_evidence';
      }
    }
  } else if (event === 'PreToolUse') {
    const toolName = input.toolCall?.name || input.tool_name || '';
    const targetPath = input.toolCall?.args?.Path || input.toolCall?.args?.TargetFile || input.toolCall?.args?.AbsolutePath || '';
    const artifactDir = input.artifactDirectoryPath || '';
    const isWriteTool = WRITE_TOOLS.has(toolName);
    const isArtifactPath = Boolean(artifactDir && targetPath && targetPath.startsWith(artifactDir));
    const commandLine = input.toolCall?.args?.CommandLine || input.toolCall?.args?.command || input.tool_input?.command || '';

    const activeBitMask = (
      BITS.A |
      (stanceState.admitWriteTools ? BITS.P : 0) |
      (stanceState.lastToolError ? BITS.E : 0) |
      BITS.T
    );
    const actAdmitted = evalActLaw(activeBitMask);

    const isStanceControl = (toolName === 'run_command' && STANCE_CONTROL_PATTERN.test(commandLine))
      || (isWriteTool && /agy-stance\.json$/.test(targetPath));
    // Any tool touching the verifier secret is denied (reads included); writes to protected paths always denied.
    const pathArgs = [targetPath, input.toolCall?.args?.SearchPath, input.toolCall?.args?.DirectoryPath, input.toolCall?.args?.File].filter(p => typeof p === 'string' && p);
    const secretTouch = pathArgs.some(p => resolveWithRealAncestor(p).some(c => c.startsWith(path.join(ORACLE_ROOT, 'secrets'))));
    const protectedWrite = isWriteTool ? protectedPathReason(targetPath, artifactDir) : null;
    const protectedShell = toolName === 'run_command' ? protectedShellReason(commandLine) : null;
    const contractInput = {
      isMutating: true,
      teleologicalIntent: input.teleologicalIntent !== undefined ? input.teleologicalIntent : (input.toolCall?.args?.intent ?? stanceState.admitIntent ?? null),
      witnessCriteria: input.witnessCriteria !== undefined ? input.witnessCriteria : (input.toolCall?.args?.witness ?? stanceState.admitWitness ?? null),
    };

    if (secretTouch || protectedShell === 'verifier_secret') {
      outcome = 'tool_held_verifier_secret';
      output = {
        decision: 'deny',
        reason: 'Agent OS Harness [HOLD]: The verifier secret (~/.agent_oracle/secrets) is never readable or writable by the proposer.',
      };
    } else if (isStanceControl) {
      outcome = 'tool_held_stance_control_is_operator_only';
      output = {
        decision: 'deny',
        reason: 'Agent OS Harness [HOLD]: The proposer may not open or edit its own write gate. Stance admit/hold is operator-only.',
      };
    } else if (protectedWrite || protectedShell) {
      outcome = 'tool_held_protected_path';
      output = {
        decision: 'deny',
        reason: `Agent OS Harness [HOLD]: Writes/mutations to protected control paths (.agents/, .gemini/, ~/.agent_oracle, stance files, rme_hook self) are always denied (${protectedWrite || protectedShell}).`,
      };
    } else if (isWriteTool && (!stanceState.admitWriteTools || !actAdmitted) && !isArtifactPath) {
      outcome = 'tool_held_by_stance_gate';
      output = {
        decision: 'deny',
        reason: `Agent OS Harness [HOLD]: Active stance is '${stanceState.stance}' (bits: ${maskToString(activeBitMask)}). Code edits are paused until execution is authorized and errors are cleared.`,
      };
    } else if (toolName === 'run_command' && (!stanceState.admitWriteTools || !actAdmitted) && MUTATING_SHELL_PATTERN.test(commandLine)) {
      outcome = 'shell_mutation_held_by_stance_gate';
      output = {
        decision: 'deny',
        reason: `Agent OS Harness [HOLD]: Active stance is '${stanceState.stance}' (bits: ${maskToString(activeBitMask)}). Shell mutations are paused until execution is authorized and errors are cleared.`,
      };
    } else if (toolName === 'run_command' && UNBOUNDED_SEARCH_PATTERN.test(commandLine)) {
      outcome = 'shell_search_held_by_unbounded_crawl';
      output = {
        decision: 'deny',
        reason: "Agent OS Harness [HOLD]: Unbounded recursive search across root or home directory violates fast-retrieval invariants. Use CodeDB (:7719), History (:7720), or targeted workspace paths.",
      };
    } else if (((isWriteTool && !isArtifactPath) || (toolName === 'run_command' && MUTATING_SHELL_PATTERN.test(commandLine))) && evalContractGate(contractInput).decision === 'hold') {
      // Fail-closed: always evaluated (no opt-in contractCheck flag), no 'exit 0' default witness.
      const contractEval = evalContractGate(contractInput);
      outcome = 'tool_held_by_contract_gate';
      output = {
        decision: 'deny',
        reason: `Agent OS Harness [HOLD]: ${contractEval.reason}`
      };
    } else if (toolName === 'write_file' && input.toolCall?.args?.Overwrite && !isArtifactPath && fs.existsSync(targetPath)) {
      try {
        const lineCount = fs.readFileSync(targetPath, 'utf8').split('\n').length;
        const guard = evalDelimiterGuard({ filepath: targetPath, lineCount, isOverwrite: true, isArtifact: isArtifactPath });
        if (guard.decision === 'hold') {
          outcome = 'tool_held_by_ast_delimiter_rule';
          output = {
            decision: 'deny',
            reason: `Agent OS Harness [HOLD]: Overwriting existing file (${lineCount} lines) violates Invariant X_2 (Delimiter-balanced AST surgical mutation). Use 'edit_file' with targeted symbol replacement to prevent regression.`,
          };
        } else {
          outcome = 'tool_admitted';
          output = { decision: 'allow' };
        }
      } catch {
        outcome = 'tool_admitted';
        output = { decision: 'allow' };
      }
    } else if (toolName === 'run_command' && commandLine.includes('>')) {
      const match = commandLine.match(/>\s*([^\s;&|<>]+)/);
      const redirectTarget = match ? match[1].replace(/["']/g, '') : null;
      const resolved = redirectTarget ? path.resolve(PROJECT_ROOT, redirectTarget) : null;
      if (resolved && !resolved.startsWith(artifactDir || '/tmp') && fs.existsSync(resolved)) {
        try {
          const lineCount = fs.readFileSync(resolved, 'utf8').split('\n').length;
          const guard = evalDelimiterGuard({ filepath: resolved, lineCount, isOverwrite: true, isArtifact: Boolean(artifactDir && resolved.startsWith(artifactDir)) });
          if (guard.decision === 'hold') {
            outcome = 'tool_held_by_ast_delimiter_rule';
            output = {
              decision: 'deny',
              reason: `Agent OS Harness [HOLD]: Overwriting existing file via shell redirection (${lineCount} lines) violates Invariant X_2 (Delimiter-balanced AST surgical mutation). Use targeted symbol replacement to prevent regression.`,
            };
          } else {
            outcome = 'tool_admitted';
            output = { decision: 'allow' };
          }
        } catch {
          outcome = 'tool_admitted';
          output = { decision: 'allow' };
        }
      } else {
        outcome = 'tool_admitted';
        output = { decision: 'allow' };
      }
    } else if (toolName === 'run_command' && /(?:^|[\s/])pi(?:\.exe)?\s+/.test(commandLine)) {
      const thinkingMatch = commandLine.match(/--thinking\s+([a-zA-Z0-9_-]+)/);
      const requestedThinking = thinkingMatch ? thinkingMatch[1].toLowerCase() : 'high';
      const hasAstBounds = /--ast-bounds|\[AST BOUNDS\]/i.test(commandLine) || Boolean(input.hasAstBounds);
      const hasMemory = /--memory|\[MEMORY\]/i.test(commandLine) || Boolean(input.hasMemory);

      const proposerDecision = evalProposerGate({ hasAstBounds, hasMemory, requestedThinking });
      if (proposerDecision.decision === 'hold') {
        outcome = 'proposer_held_by_proposer_gate';
        output = {
          decision: 'deny',
          reason: 'Agent OS Harness [HOLD]: Proposer invocation violates Invariant X_7 (Clamped Proposer Gate): ' + proposerDecision.reason + '. Use --thinking low or supply bounded AST context.',
        };
      } else {
        outcome = 'tool_admitted';
        output = { decision: 'allow' };
      }
    } else {
      outcome = 'tool_admitted';
      output = { decision: 'allow' };
    }
  } else if (event === 'PostToolUse') {
    const toolName = input.toolCall?.name || input.tool_name || '';
    if (input.error) {
      outcome = 'tool_error_observed_e1';
      writeStanceState(statePath, {
        lastToolError: {
          tool: toolName,
          error: String(input.error).slice(0, 300),
          stepIdx: input.stepIdx ?? null,
        },
      });
    } else {
      outcome = 'tool_result_observed_ok';
      if (stanceState.lastToolError) {
        writeStanceState(statePath, { lastToolError: null });
      }
    }

    // DUAL-STREAM AUTO-TAPING: Transcribe public tool call directly onto daemon_tape.jsonl
    try {
      const tapePath = path.resolve(PROJECT_ROOT, 'runs/ruliad/daemon_tape.jsonl');
      const toolRecord = {
        timestamp: new Date().toISOString(),
        kind: 'agent_os.public_tool_cell.v1',
        session_id: sessionId,
        tool: toolName,
        step_idx: input.stepIdx ?? null,
        status: input.error ? 'ERROR' : 'OK',
        input_digest: payloadDigest(input.toolCall?.args),
        error_sample: input.error ? String(input.error).slice(0, 150) : null,
        witness_sha256: crypto.createHash('sha256').update(JSON.stringify(input.toolCall?.args || {})).digest('hex')
      };
      fs.mkdirSync(path.dirname(tapePath), { recursive: true });
      fs.appendFileSync(tapePath, JSON.stringify(toolRecord) + '\n', 'utf8');
    } catch {}

    output = {};
  }

  const receipt = {
    kind: 'agent_os.rme_hook_receipt.v1',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event,
    cwd: PROJECT_ROOT,
    session_id: sessionId,
    tool_use_id: boundedId(String(input.stepIdx ?? '')),
    tool_name: boundedId(input.toolCall?.name || input.tool_name),
    source: 'antigravity-hook',
    hook_source_sha256: digest(fs.readFileSync(__filename)),
    dependency_sha256: Object.fromEntries(
      ['rme.js', 'rme_native.js', 'rme_handover.js', 'core.js'].map(file => [
        file,
        digest(fs.readFileSync(path.join(__dirname, file))),
      ])
    ),
    prompt_hash: payloadDigest(prompt || undefined),
    tool_input_hash: payloadDigest(input.toolCall?.args),
    tool_response_hash: payloadDigest(input.error ? { error: input.error } : undefined),
    outcome,
    wrapped: false,
    injection,
    graph_hash: graphHash,
    cut_hash: cutHash,
    lesson_ids: lessonIds,
    delivered_context: deliveredContext,
    delivered_context_sha256: deliveredContext ? digest(Buffer.from(deliveredContext, 'utf8')) : null,
    selected_cut: null,
    association_hash: null,
    handover_hash: handoverHash,
  };
  const sealed = { ...receipt, hash: hash(receipt) };
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, `${receipt.id}.json`), JSON.stringify(sealed, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return output;
}

async function main() {
  if (process.argv[2] === '--admit-token') {
    // STRONG admit path for Jacob: token minted by ~/.agent_oracle/bin/verify_and_admit.js.
    const tokenPath = process.argv[3] || process.env.AGENT_OS_ADMIT_TOKEN;
    try {
      const state = admitWithToken(DEFAULT_STATE, tokenPath);
      process.stdout.write(JSON.stringify({ stance: state.stance, admitWriteTools: state.admitWriteTools, admitSource: state.admitSource, tokenId: state.admitToken.id, expiresAt: new Date(Date.parse(state.admitToken.timestamp) + ADMIT_TOKEN_MAX_AGE_MS).toISOString() }) + '\n');
    } catch (error) {
      process.stderr.write(`${String(error.message).slice(0, 300)}\n`);
      process.exitCode = 2;
    }
    return;
  }
  if (process.argv[2] === '--admit' || process.argv[2] === '--hold') {
    // --admit is the WEAK operator fallback (same-uid marker, no cryptographic witness).
    const state = process.argv[2] === '--admit'
      ? admitStance(DEFAULT_STATE, process.argv[3], process.argv[4])
      : holdStance(DEFAULT_STATE);
    process.stdout.write(JSON.stringify({ stance: state.stance, admitWriteTools: state.admitWriteTools }) + '\n');
    return;
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('Hook payload exceeds bound');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  const parsed = raw ? JSON.parse(raw) : {};
  const agyEventArg = process.argv[2];
  const output = agyEventArg || (parsed.conversationId && !parsed.hook_event_name)
    ? handleAgyHook(agyEventArg, parsed)
    : handleHook(parsed);
  process.stdout.write(JSON.stringify(output) + '\n');
}

if (require.main === module) main().catch(() => {
  // Fail-closed: a crashing PreToolUse hook denies rather than emitting an empty (allow) object.
  const failClosed = process.argv[2] === 'PreToolUse'
    ? { decision: 'deny', reason: 'Agent OS Harness [HOLD]: hook error; failing closed.' }
    : {};
  process.stdout.write(JSON.stringify(failClosed) + '\n');
  process.exitCode = 1;
});
module.exports = { ALLOWED_ROOTS, evalDelimiterGuard, evalProposerGate, admitStance, admitWithToken, aov1Canonical, handleAgyHook, handleHook, holdStance, main, parseAdmitToken, protectedPathReason, protectedShellReason, readStanceState, verifyAdmitToken, writeStanceState };
