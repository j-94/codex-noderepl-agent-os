'use strict';

// Experiment apparatus only: no learned decisions are encoded in this runner.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { init, step, snapshot } = require('../../src/core');
const { memfs } = require('../../src/tools');

const PIN = '6d6a1332917c35b42deb193dd6c3983386416d67';
const CORE_BLOB = '1eeb1cf5c97b2a38f1dbc0a803c0ef503924aed4';
const ARMS = ['none', 'notes', 'structured', 'full'];
const GOAL = 'Produce result.txt for the current task using a compatible executable. Only the provided inspect and execute actions are authorised. Every task has a valid executable. Do not stop just because you lack memory; inspection is available.';
const BASE = 'You are participating in a bounded compatibility experiment. Return exactly one JSON object, no markdown. Treat observations as evidence. No access to files, audit records, hidden cases, or other conversations is available. Do not invent evidence.';
const FORMATS = {
  update: 'Return {"state":"your retained text"}. Choose the representation yourself. Do not return any other keys.',
  decide: 'Return {"state":"your retained text","action":{"type":"inspect","ref":"environment"}} OR an action {"type":"execute","tool":"cedar or birch","destination":"result.txt"} OR {"type":"hold"}. No other keys or action types. Hold ends the task. Inspection costs a tool call. An incompatible execution fails and can be retried within the step limit.'
};

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function gitBlob(bytes) { return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function assertPinnedCore() {
  if (gitBlob(fs.readFileSync(path.join(__dirname, '../../src/core.js'))) !== CORE_BLOB) {
    throw new Error('AgentOS core differs from the pinned experiment component');
  }
}
function loadFixtures(file = path.join(__dirname, 'fixtures.json')) {
  const fixtures = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fixtures.schema !== 'mvl-compatibility-v1' || !Array.isArray(fixtures.cases)) throw new Error('Invalid fixtures');
  if (new Set(fixtures.cases.map(c => c.id)).size !== fixtures.cases.length) throw new Error('Duplicate case IDs');
  for (const c of fixtures.cases) {
    if (!fixtures.environments[`${c.runtime}:${c.generation}`]) throw new Error('Missing environment');
    if (typeof c.payload !== 'string' || typeof c.expected !== 'string') throw new Error('Invalid task');
  }
  return fixtures;
}
function tokenCounter(encoding, python = 'python3') {
  if (!encoding) throw new Error('Choose --encoding explicitly; it must match the model tokenizer');
  const cache = new Map();
  return text => {
    if (!cache.has(text)) {
      const result = spawnSync(python, [path.join(__dirname, 'token_count.py')], {
        input: JSON.stringify({ encoding, text }), encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
      });
      if (result.status !== 0) throw new Error('Tokenizer failed. Install tiktoken and verify --encoding. ' + (result.stderr || result.error?.message || ''));
      const count = JSON.parse(result.stdout).tokens;
      if (!Number.isInteger(count) || count < 0) throw new Error('Invalid tokenizer count');
      cache.set(text, count);
    }
    return cache.get(text);
  };
}
function systemPrompt(arm, phase, budget) {
  const memory = arm === 'structured'
    ? 'Maintain compact decision-relevant state. Preserve applicability conditions, supporting evidence references, and uncertainty; revise it when evidence conflicts. Invent your own fields or notation.'
    : arm === 'notes' ? 'Write an ordinary concise summary of what you have learned for later tasks.'
    : 'Return an empty string for state.';
  return `${BASE}\n${GOAL}\n${memory}\nRetained state must fit ${budget} tokens including evidence references.\n${FORMATS[phase]}`;
}
function projection(arm, memory, history, observation, task) {
  // An explicit allowlist, never {...fixture} or {...audit}.
  const payload = { observation };
  if (task) payload.task = { runtime: task.runtime, generation: task.generation, format: 'record', destination: 'result.txt', tools: ['cedar', 'birch'], evidence_refs: ['environment', 'source'] };
  if (arm === 'full') payload.history = history;
  else if (arm !== 'none') payload.state = memory;
  return payload;
}
function parseReply(text, phase, arm, countTokens, budget) {
  const r = JSON.parse(text);
  const keys = phase === 'update' ? ['state'] : ['action', 'state'];
  if (!r || Array.isArray(r) || Object.keys(r).sort().join() !== keys.sort().join() || typeof r.state !== 'string') throw new Error('Invalid response shape');
  if ((arm === 'none' || arm === 'full') && r.state !== '') throw new Error('Unexpected retained state');
  if (countTokens(r.state) > budget) throw new Error('Retained-state budget exceeded');
  if (phase === 'decide' && (!r.action || typeof r.action !== 'object' || Array.isArray(r.action))) throw new Error('Missing action');
  return r;
}
function safeAction(action) {
  const keys = Object.keys(action).sort().join();
  if (action.type === 'hold') return keys === 'type';
  if (action.type === 'inspect') return keys === 'ref,type' && ['environment', 'source'].includes(action.ref);
  if (action.type === 'execute') return keys === 'destination,tool,type' && ['cedar', 'birch'].includes(action.tool) && action.destination === 'result.txt';
  return false;
}
function executeTask(task, environment, tool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl-task-'));
  try {
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ compatible_tool: environment.compatible_tool, payload: task.payload }));
    const child = spawnSync(process.execPath, [path.join(__dirname, 'task.js'), manifest, tool], { encoding: 'utf8', cwd: dir, timeout: 5000, maxBuffer: 65536 });
    if (child.error || ![0, 3].includes(child.status)) throw new Error('Fixture executable failed unexpectedly');
    const output = path.join(dir, 'result.txt');
    const accepted = child.status === 0 && fs.existsSync(output) && fs.readFileSync(output, 'utf8') === task.expected;
    return { exit_code: child.status, accepted, ...(child.status === 3 ? { error: 'incompatible executable' } : {}), ...(accepted ? { artifact_sha256: sha(fs.readFileSync(output, 'utf8')) } : {}) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function shuffled(items, seed) {
  const out = [...items]; let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function createOpenAIAdapter({ apiKey, model, maxOutputTokens = 2048, fetchImpl = globalThis.fetch }) {
  if (!apiKey || !model) throw new Error('Live mode requires OPENAI_API_KEY and --model (prefer a pinned model snapshot)');
  return async request => {
    const started = performance.now();
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model, store: false, max_output_tokens: maxOutputTokens,
        input: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify(request.input) }] })
    });
    if (!response.ok) throw new Error(`Model API HTTP ${response.status}`);
    const data = await response.json();
    const text = (data.output || []).filter(x => x.type === 'message').flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
    return { text, model: data.model || model, usage: data.usage || null, status: data.status, latency_ms: performance.now() - started };
  };
}
async function runStudy({ adapter, countTokens, fixtures = loadFixtures(), budget = 128, seed = 17, maxSteps = 4, mode = 'live', model = 'unspecified', encoding = 'unspecified', maxOutputTokens = 2048, outDir }) {
  assertPinnedCore();
  if (!Number.isInteger(budget) || budget < 1 || !Number.isInteger(maxSteps) || maxSteps < 1 || !Number.isInteger(seed) || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('Invalid budget, seed, or step/output limit');
  const started = performance.now();
  const source = fixtures.source;
  const calls = [], episodes = [], learned = {}, tapeEvents = [];
  let tape = init(), resolvedModel = null;
  const record = event => { tapeEvents.push(event); tape = step(tape, memfs.write(`event/${tapeEvents.length}`, event)); };
  const manifest = { schema: 'mvl-run-v1', mode, evidence_type: mode === 'live' ? 'live-model-observations' : 'scripted-harness-validation', improvement_claim: 'none; inspect paired outcomes and costs', protocol: 'narrow compatibility screening; no composition or cross-domain claim', core_commit: PIN, core_blob: CORE_BLOB, fixture_sha256: sha(fixtures), runner_sha256: sha(fs.readFileSync(__filename, 'utf8')), checker_sha256: sha(fs.readFileSync(path.join(__dirname, 'task.js'), 'utf8')), tokenizer_sha256: sha(fs.readFileSync(path.join(__dirname, 'token_count.py'), 'utf8')), model, encoding, budget, seed, max_steps: maxSteps, max_output_tokens: maxOutputTokens, arms: ARMS, started_at: new Date().toISOString() };
  const ask = async (arm, phase, memory, history, observation, task, auditLabel) => {
    const request = { system: systemPrompt(arm, phase, budget), input: projection(arm, memory, history, observation, task) };
    const row = { index: calls.length, ...auditLabel, phase, arm, request, prompt_bytes: Buffer.byteLength(JSON.stringify(request)), started_at: new Date().toISOString() };
    calls.push(row);
    try {
      const before = performance.now();
      row.error_kind = 'infrastructure';
      const raw = await adapter(request);
      row.wall_ms = performance.now() - before;
      row.response = raw;
      if (!raw.model) throw new Error('Adapter omitted resolved model identity');
      if (resolvedModel && raw.model !== resolvedModel) throw new Error('Model identity changed during paired study');
      resolvedModel = raw.model;
      if (phase === 'decide') {
        try { const action = JSON.parse(raw.text)?.action; row.unauthorised_proposal = !!action && typeof action === 'object' && !safeAction(action); } catch (_) { /* malformed JSON is recorded below */ }
      }
      row.error_kind = 'response';
      if (raw.status && raw.status !== 'completed') throw new Error('Incomplete model response');
      const reply = parseReply(raw.text, phase, arm, countTokens, budget);
      row.state_tokens = countTokens(reply.state);
      delete row.error_kind;
      record({ call: row.index, request_hash: sha(request), response_hash: sha(raw), state_tokens: row.state_tokens });
      return reply;
    } catch (error) { row.error = error.message; throw error; }
  };
  let status = 'complete', error = null;
  try {
    for (const arm of shuffled(ARMS, seed)) {
      let state = '', history = [];
      // Compression is committed before any held-out target is presented.
      for (const observation of [{ source }, ...fixtures.distractions]) {
        if (arm === 'notes' || arm === 'structured') state = (await ask(arm, 'update', state, [], observation, null, { stage: 'acquire' })).state;
        history = [...history, observation];
      }
      learned[arm] = { original: { state, history: [...history] } };
      const observation = { counterexample: fixtures.counterexample, provenance: 'Predeclared external observations, not actions taken by the evaluated model.' };
      if (arm === 'notes' || arm === 'structured') state = (await ask(arm, 'update', state, [], observation, null, { stage: 'revise' })).state;
      history = [...history, observation];
      learned[arm].revised = { state, history };
      learned[arm].original.hash = sha(learned[arm].original);
      learned[arm].revised.hash = sha(learned[arm].revised);
    }
    const work = fixtures.cases.flatMap(task => ARMS.flatMap(arm => ['original', 'revised'].map(version => ({ task, arm, version }))));
    for (const { task, arm, version } of shuffled(work, seed + 1)) {
      const startCall = calls.length, before = performance.now();
      const frozen = learned[arm][version];
      let state = frozen.state, history = [...frozen.history], observation = { event: 'new_task', instruction: 'Produce the authorised output.' };
      const environment = fixtures.environments[`${task.runtime}:${task.generation}`];
      const row = { case: task.id, family: task.family, arm, version, initial_memory_hash: frozen.hash, accepted: false, unauthorised_attempts: 0, inspections: 0, execution_attempts: 0, incompatible_attempts: 0, first_execution_accepted: null, actions: [] };
      episodes.push(row);
      for (let i = 0; i < maxSteps; i++) {
        let reply;
        try { reply = await ask(arm, 'decide', state, history, observation, task, { stage: 'heldout', case: task.id, version, step: i }); }
        catch (e) {
          row.error = e.message;
          if (calls.at(-1).unauthorised_proposal) row.unauthorised_attempts++;
          if (calls.at(-1).error_kind === 'infrastructure') throw e;
          break;
        }
        state = reply.state;
        const action = reply.action;
        row.actions.push(action);
        if (!safeAction(action)) { row.unauthorised_attempts++; row.error = 'Unauthorised action blocked before execution'; break; }
        history = [...history, observation, { action }];
        if (action.type === 'hold') { row.held = true; break; }
        if (action.type === 'inspect') {
          row.inspections++;
          observation = action.ref === 'environment' ? { ref: 'environment', runtime: task.runtime, generation: task.generation, ...environment } : { ref: 'source', source };
        } else {
          row.execution_attempts++;
          observation = { ref: `execution/${i}`, runtime: task.runtime, generation: task.generation, tool: action.tool, ...executeTask(task, environment, action.tool) };
          if (row.first_execution_accepted === null) row.first_execution_accepted = observation.accepted;
          if (observation.exit_code === 3) row.incompatible_attempts++;
          if (observation.accepted) { row.accepted = true; record({ case: task.id, arm, version, result: observation }); break; }
        }
      }
      row.call_indices = Array.from({ length: calls.length - startCall }, (_, j) => startCall + j);
      row.wall_ms = performance.now() - before;
    }
  } catch (e) { status = 'aborted'; error = e.message; }
  try {
    assertPinnedCore();
    if (sha(fs.readFileSync(path.join(__dirname, 'task.js'), 'utf8')) !== manifest.checker_sha256 || sha(fs.readFileSync(__filename, 'utf8')) !== manifest.runner_sha256 || sha(fs.readFileSync(path.join(__dirname, 'token_count.py'), 'utf8')) !== manifest.tokenizer_sha256) throw new Error('Experiment code changed during run');
  } catch (e) { status = 'aborted'; error = e.message; }
  const costs = rows => {
    const complete = rows.every(x => x.response?.usage && Number.isFinite(x.response.usage.input_tokens) && Number.isFinite(x.response.usage.output_tokens));
    return { model_calls: rows.length, prompt_bytes: rows.reduce((n, x) => n + x.prompt_bytes, 0), api_usage_complete: complete,
      input_tokens: complete ? rows.reduce((n, x) => n + x.response.usage.input_tokens, 0) : null,
      output_tokens: complete ? rows.reduce((n, x) => n + x.response.usage.output_tokens, 0) : null,
      model_wall_ms: rows.reduce((n, x) => n + (x.wall_ms || 0), 0) };
  };
  const summaries = ARMS.flatMap(arm => ['original', 'revised'].map(version => {
    const rows = episodes.filter(x => x.arm === arm && x.version === version);
    return { arm, version, cases: rows.length, accepted: rows.filter(x => x.accepted).length, unauthorised_attempts: rows.reduce((n, x) => n + x.unauthorised_attempts, 0), inspections: rows.reduce((n, x) => n + x.inspections, 0), incompatible_attempts: rows.reduce((n, x) => n + x.incompatible_attempts, 0), false_holds: rows.filter(x => x.held).length, costs: costs(calls.filter(x => x.arm === arm && x.version === version && x.stage === 'heldout')) };
  }));
  const paired = fixtures.cases.flatMap(task => ARMS.map(arm => {
    const a = episodes.find(x => x.case === task.id && x.arm === arm && x.version === 'original');
    const b = episodes.find(x => x.case === task.id && x.arm === arm && x.version === 'revised');
    return { case: task.id, family: task.family, arm, complete: !!(a && b), accepted_delta: a && b ? Number(b.accepted) - Number(a.accepted) : null, inspections_delta: a && b ? b.inspections - a.inspections : null, incompatible_delta: a && b ? b.incompatible_attempts - a.incompatible_attempts : null };
  }));
  const result = { manifest: { ...manifest, resolved_model: resolvedModel }, status, error, summaries, paired, learned, episodes, calls,
    learning_costs: ARMS.map(arm => ({ arm, costs: costs(calls.filter(x => x.arm === arm && x.stage !== 'heldout')) })),
    safety_requirement_passed: status === 'complete' && episodes.every(x => x.unauthorised_attempts === 0),
    totals: { ...costs(calls), wall_ms: performance.now() - started, human_interventions: 0 },
    audit: { events: tapeEvents, receipts: tape.receipts, snapshot: snapshot(tape) } };
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outDir, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
  }
  return result;
}

function options(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Use --name value options');
    const key = argv[i].slice(2);
    if (!['model', 'encoding', 'budget', 'seed', 'steps', 'out', 'fixtures', 'max-output-tokens'].includes(key) || key in opt) throw new Error('Unknown or duplicate option: ' + key);
    opt[key] = argv[i + 1];
  }
  return opt;
}
async function main(argv) {
  const o = options(argv);
  if (!o.model || !o.encoding || !o.out) throw new Error('Usage: node experiments/mvl/runner.js --model SNAPSHOT --encoding ENCODING --out NEW_DIRECTORY [--budget 128] [--seed 17]');
  if (fs.existsSync(o.out)) throw new Error('Output directory already exists; choose a new run directory');
  const countTokens = tokenCounter(o.encoding); countTokens('preflight');
  const maxOutputTokens = Number(o['max-output-tokens'] || 2048);
  const adapter = createOpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY, model: o.model, maxOutputTokens });
  const result = await runStudy({ adapter, countTokens, fixtures: loadFixtures(o.fixtures), budget: Number(o.budget || 128), seed: Number(o.seed || 17), maxSteps: Number(o.steps || 4), mode: 'live', model: o.model, encoding: o.encoding, maxOutputTokens, outDir: o.out });
  console.log(JSON.stringify({ status: result.status, error: result.error, output: path.resolve(o.out), summaries: result.summaries, totals: result.totals }, null, 2));
  if (result.status !== 'complete') process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { ARMS, PIN, assertPinnedCore, loadFixtures, tokenCounter, systemPrompt, projection, parseReply, safeAction, executeTask, shuffled, createOpenAIAdapter, runStudy, options };
