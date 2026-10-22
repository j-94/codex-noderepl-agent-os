'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { init, step } = require('../../src/core');
const { memfs } = require('../../src/tools');
const { loadFixtures, tokenCounter, parseReply, projection, safeAction, executeTask, createOpenAIAdapter, runStudy } = require('./runner');

// A SCRIPTED test double. It learns a lookup table from *visible* successful
// observations solely to exercise the apparatus. Never report this as LLM learning.
function scriptedAdapter(request) {
  const p = request.input;
  let memory = p.state ? JSON.parse(p.state) : {};
  const absorb = obs => {
    for (const row of [...(obs.source || []), ...(obs.counterexample || [])]) {
      if (row.accepted) memory[`${row.runtime}:${row.generation}`] = row.tool;
    }
  };
  for (const obs of p.history || []) absorb(obs);
  absorb(p.observation);
  const noState = request.system.includes('Return an empty string for state.');
  const state = noState ? '' : JSON.stringify(memory);
  if (!p.task) return Promise.resolve({ text: JSON.stringify({ state }), model: 'scripted-visible-evidence-only', usage: null, status: 'completed' });
  const tool = p.observation.compatible_tool || memory[`${p.task.runtime}:${p.task.generation}`];
  return Promise.resolve({ text: JSON.stringify({ state, action: tool ? { type: 'execute', tool, destination: 'result.txt' } : { type: 'inspect', ref: 'environment' } }), model: 'scripted-visible-evidence-only', usage: null, status: 'completed' });
}
const characters = s => [...s].length;
function smallFixtures() { const f = loadFixtures(); return { ...f, cases: [f.cases[0], f.cases[3], f.cases[6]] }; }
const config = { countTokens: characters, budget: 512, encoding: 'test-characters-NOT-model-tokens', mode: 'scripted', model: 'scripted-visible-evidence-only' };

test('model payload excludes hidden evaluator, labels, tape, and history for compact arms', () => {
  const c = { ...loadFixtures().cases[0], audit: 'secret', expected: 'secret' };
  for (const arm of ['none', 'notes', 'structured']) {
    const p = projection(arm, 'bounded', [{ secret: 'history' }], { event: 'new' }, c);
    assert.equal('history' in p, false);
    for (const forbidden of ['expected', 'family', 'payload', 'case', 'audit']) assert.equal(forbidden in p.task, false);
    assert.equal(JSON.stringify(p).includes('secret'), false);
    assert.equal('state' in p, arm !== 'none');
  }
});

test('state limit fails closed and never silently truncates or permits extra memory fields', () => {
  assert.throws(() => parseReply(JSON.stringify({ state: 'a'.repeat(129) }), 'update', 'notes', characters, 128), /budget/);
  assert.throws(() => parseReply('{"state":"ok","hidden_memory":"more"}', 'update', 'structured', characters, 128), /shape/);
  assert.throws(() => parseReply('{"state":"secret"}', 'update', 'none', characters, 128), /Unexpected/);
});

test('scope rejects arbitrary tool names, file destinations, and audit retrieval', () => {
  assert.equal(safeAction({ type: 'execute', tool: 'cedar', destination: '../escape' }), false);
  assert.equal(safeAction({ type: 'inspect', ref: 'audit' }), false);
  assert.equal(safeAction({ type: 'execute', tool: 'bash', destination: 'result.txt' }), false);
  assert.equal(safeAction({ type: 'execute', tool: 'cedar', destination: 'result.txt', command: 'write' }), false);
});

test('the actual disposable executable fails incompatibility and independently verifies the artifact', () => {
  const f = loadFixtures(), c = f.cases[0], e = f.environments['engine-1:1'];
  assert.equal(executeTask(c, e, 'birch').accepted, false);
  assert.equal(executeTask(c, e, 'birch').exit_code, 3);
  assert.equal(executeTask(c, e, 'cedar').accepted, true);
  assert.equal(executeTask({ ...c, expected: 'deliberately wrong oracle' }, e, 'cedar').accepted, false);
});

test('OpenAI calls are fresh, omit tools and conversation IDs, and retain actual API usage', async () => {
  const bodies = [];
  const adapter = createOpenAIAdapter({ apiKey: 'fixture-key', model: 'fixture-model', fetchImpl: async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ model: 'fixture-model', status: 'completed', usage: { input_tokens: 7, output_tokens: 3 }, output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'DO NOT REPLAY' }] }, { type: 'message', content: [{ type: 'output_text', text: '{"state":""}' }] }] }) };
  } });
  const r = await adapter({ system: 'JSON please', input: { observation: 'first' } });
  await adapter({ system: 'JSON please', input: { observation: 'second' } });
  assert.equal(r.text, '{"state":""}'); assert.equal(r.usage.input_tokens, 7);
  for (const b of bodies) {
    assert.equal(b.store, false); assert.equal(b.input.length, 2);
    for (const k of ['previous_response_id', 'conversation', 'tools']) assert.equal(k in b, false);
  }
  assert.equal(JSON.stringify(bodies[1]).includes('first'), false);
});

test('paired study freezes memories, limits leakage, scores recovery, and supports receipt replay', async () => {
  const seen = [];
  const result = await runStudy({ ...config, fixtures: smallFixtures(), adapter: async req => { seen.push(req); return scriptedAdapter(req); } });
  assert.equal(result.status, 'complete'); assert.equal(result.episodes.length, 24);
  assert.equal(result.paired.length, 12); assert.ok(result.paired.every(x => x.complete));
  assert.ok(result.episodes.every(x => x.accepted));
  assert.equal(result.totals.api_usage_complete, false);
  const originalChanged = result.episodes.find(x => x.arm === 'structured' && x.version === 'original' && x.family === 'changed');
  const revisedChanged = result.episodes.find(x => x.arm === 'structured' && x.version === 'revised' && x.family === 'changed');
  assert.equal(originalChanged.inspections, 1); assert.equal(revisedChanged.inspections, 0);
  const original = JSON.parse(result.learned.structured.original.state), revised = JSON.parse(result.learned.structured.revised.state);
  assert.equal(original['engine-1:2'], undefined); assert.equal(revised['engine-1:2'], 'birch');
  assert.equal(revised['engine-1:1'], 'cedar');
  for (const req of seen.filter(x => !x.input.task)) assert.equal('task' in req.input, false);
  for (const arm of ['notes', 'structured']) for (const version of ['original', 'revised']) {
    assert.ok(result.episodes.filter(x => x.arm === arm && x.version === version).every(x => x.initial_memory_hash === result.learned[arm][version].hash));
  }
  let replay = init();
  result.audit.events.forEach((event, i) => { replay = step(replay, memfs.write(`event/${i + 1}`, event)); });
  assert.deepEqual(replay.receipts, result.audit.receipts);
});

test('always holding earns zero accepted tasks', async () => {
  const f = smallFixtures(); f.cases = f.cases.slice(0, 1);
  const adapter = async req => {
    if (!req.input.task) return scriptedAdapter(req);
    return { text: JSON.stringify({ state: req.input.state || '', action: { type: 'hold' } }), model: 'scripted-visible-evidence-only' };
  };
  const r = await runStudy({ ...config, fixtures: f, adapter });
  assert.equal(r.episodes.filter(x => x.accepted).length, 0);
  assert.equal(r.episodes.filter(x => x.held).length, 8);
});

test('unauthorised proposals count even when oversized memory blocks response acceptance', async () => {
  const f = smallFixtures(); f.cases = f.cases.slice(0, 1);
  const adapter = async req => {
    if (!req.input.task) return scriptedAdapter(req);
    return { text: JSON.stringify({ state: 'x'.repeat(600), action: { type: 'execute', tool: 'cedar', destination: '../escape' } }), model: 'scripted-visible-evidence-only' };
  };
  const r = await runStudy({ ...config, fixtures: f, adapter });
  assert.equal(r.episodes.reduce((n, x) => n + x.unauthorised_attempts, 0), 8);
  assert.equal(r.episodes.reduce((n, x) => n + x.execution_attempts, 0), 0);
});

test('model identity changes abort the study and preserve partial evidence', async () => {
  let n = 0;
  const r = await runStudy({ ...config, fixtures: smallFixtures(), adapter: async req => ({ ...await scriptedAdapter(req), model: ++n === 1 ? 'first' : 'different' }) });
  assert.equal(r.status, 'aborted'); assert.match(r.error, /identity changed/); assert.equal(r.calls.length, 2);
});

test('API errors are not counted as task performance; incomplete output stays visible', async () => {
  const r = await runStudy({ ...config, adapter: async () => { throw new Error('network unavailable'); } });
  assert.equal(r.status, 'aborted'); assert.equal(r.episodes.length, 0); assert.equal(r.calls[0].error_kind, 'infrastructure');
  const incomplete = await runStudy({ ...config, adapter: async req => ({ ...await scriptedAdapter(req), status: 'incomplete' }) });
  assert.equal(incomplete.status, 'aborted'); assert.match(incomplete.error, /Incomplete/);
});

// node test.js --smoke --out DIR [--encoding o200k_base]
// Without --encoding this deliberately uses character units, NOT model tokens.
if (process.argv.includes('--smoke')) {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
  const out = arg('--out') || fs.mkdtempSync(path.join(os.tmpdir(), 'mvl-smoke-'));
  const encoding = arg('--encoding');
  const cfg = encoding ? { ...config, countTokens: tokenCounter(encoding), budget: 128, encoding } : config;
  runStudy({ ...cfg, adapter: scriptedAdapter, outDir: out }).then(r => {
    assert.equal(r.status, 'complete'); assert.equal(r.episodes.length, 96);
    assert.ok(r.episodes.every(e => e.accepted && e.unauthorised_attempts === 0));
    console.log(JSON.stringify({ mode: 'SCRIPTED HARNESS VALIDATION — NOT LLM RESULTS', output: out, episodes: r.episodes.length, model_calls: r.totals.model_calls, encoding, max_state_units: Math.max(...r.calls.map(x => x.state_tokens || 0)) }, null, 2));
  }).catch(e => { console.error(e); process.exitCode = 1; });
}

module.exports = { scriptedAdapter };
