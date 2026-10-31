'use strict';

const { performance } = require('node:perf_hooks');
const { hash, freeze } = require('./core');
const { copyJson, createLoop, validateLoop, runCycle } = require('./improvement_loop');
const { createRuliad, validateRuliad, recordExperience } = require('./rme');
const { ROUTING_INITIAL, makeRoutingAdapter } = require('./improvement_routing');

const KIND = 'agent_os.program_branch.v1';
const ownedBranches = new WeakMap();
const STAGES = ['observe', 'propose', 'execute', 'compare', 'retain'];
const check = (condition, message) => { if (!condition) throw new Error(message); };
const signed = value => freeze({ ...copyJson(value), hash: hash(value) });
const unsigned = value => { const { hash: ignored, ...body } = value; return body; };
const text = value => typeof value === 'string' && value.trim().length > 0;
const exact = (value, keys) => check(value && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'Unexpected program fields');
const ref = (kind, value) => ({ path: `mem://transition-program/${kind}/${hash(value)}`, sha256: hash(value) });

function adapterInitial(adapter) {
  check(adapter && text(adapter.id) && adapter.operations && typeof adapter.operations === 'object', 'Invalid host adapter');
  return createLoop(copyJson(adapter.initial));
}

function rememberOwned(branch, cacheKey) {
  ownedBranches.set(branch, cacheKey);
  return branch;
}

function createProgramBranch(adapter) {
  adapter = { id: adapter.id, initial: copyJson(adapter.initial), operations: adapter.operations };
  const loop = adapterInitial(adapter);
  return rememberOwned(signed({ kind: KIND, adapter_id: adapter.id, loop, graph: createRuliad({ purpose: loop.purpose }), programs: [], receipts: [] }), hash({ id: adapter.id, initial: loop }));
}

function inspectProgram(input, adapter) {
  const initial = adapterInitial(adapter);
  const program = copyJson(input);
  exact(program, ['goal', 'state', 'steps', 'budget']);
  check(program.goal === initial.purpose, 'Program goal must match host purpose');
  check(program.state === 'current-state' || /^[a-f0-9]{64}$/.test(program.state), 'Invalid program state');
  exact(program.budget, ['humanMinutes', 'toolCalls']);
  check(Number.isFinite(program.budget.humanMinutes) && program.budget.humanMinutes >= 0 && Number.isSafeInteger(program.budget.toolCalls) && program.budget.toolCalls >= 0, 'Invalid program budget');
  check(Array.isArray(program.steps) && program.steps.length === STAGES.length, 'Expected five ordered operations');
  const operations = program.steps.map((step, index) => {
    check(Array.isArray(step) && step.length === 2 && step[0] === STAGES[index] && text(step[1]), 'Invalid operation order or target');
    const [stage, target] = step;
    if (stage === 'retain') check(target === 'if-verified-better', 'Retention requires verified improvement');
    else check(Object.hasOwn(adapter.operations, stage) && Object.hasOwn(adapter.operations[stage], target) && typeof adapter.operations[stage][target] === 'function', 'Unknown host operation target');
    return { stage, target };
  });
  return freeze({ program, hash: hash(program), operations, minimum_tool_calls: 5 });
}

function validatedBranch(input, adapter) {
  const initial = adapterInitial(adapter);
  const cacheKey = hash({ id: adapter.id, initial });
  if (ownedBranches.get(input) === cacheKey) return input;
  const branch = copyJson(input);
  exact(branch, ['kind', 'adapter_id', 'loop', 'graph', 'programs', 'receipts', 'hash']);
  check(branch.kind === KIND && branch.adapter_id === adapter.id && branch.hash === hash(unsigned(branch)), 'Program branch integrity mismatch');
  validateLoop(branch.loop); validateRuliad(branch.graph);
  check(branch.loop.purpose === initial.purpose && branch.loop.evaluation_id === initial.evaluation_id && hash(branch.loop.genesis) === hash(initial.genesis), 'Host adapter anchor mismatch');
  check(Array.isArray(branch.programs) && Array.isArray(branch.receipts), 'Invalid branch history');
  for (const entry of branch.programs) {
    check(entry.hash === hash(unsigned(entry)) && entry.program_hash === hash(entry.program), 'Retained program integrity mismatch');
    check(branch.loop.cycles.some(cycle => cycle.hash === entry.cycle_hash && cycle.decisions.project === 'accepted'), 'Retained program lacks accepted cycle');
    check(branch.graph.nodes.some(node => node.id === entry.lesson_id && node.type === 'lesson' && node.data.action === `Execute program:${entry.program_hash}`), 'Retained program lacks lesson');
  }
  for (const receipt of branch.receipts) check(receipt.hash === hash(unsigned(receipt)), 'Program receipt integrity mismatch');
  const owned = freeze(branch);
  ownedBranches.set(owned, cacheKey);
  return owned;
}

async function runTransitionProgram(inputBranch, inputProgram, adapter, { input = null } = {}) {
  const started = performance.now();
  adapter = { id: adapter.id, initial: freeze(copyJson(adapter.initial)), operations: adapter.operations };
  const inspected = inspectProgram(inputProgram, adapter);
  const branch = validatedBranch(inputBranch, adapter);
  const program = inspected.program;
  check(program.state === 'current-state' || program.state === branch.loop.hash, 'Stale program state');
  const taskInput = freeze(copyJson(input));
  const handlers = Object.fromEntries(inspected.operations.filter(op => op.stage !== 'retain').map(op => [op.stage, { ...op, fn: adapter.operations[op.stage][op.target] }]));
  const trace = [];
  let toolCalls = 0;
  let execution = null;
  let research = null;
  const invoke = async (stage, context) => {
    const handler = handlers[stage];
    const snapshot = freeze(copyJson({ ...context, input: taskInput, research }));
    const entry = { sequence: trace.length + 1, stage, target: handler.target, input_hash: hash(snapshot), output: null, output_hash: null, status: 'pending', error: null, elapsed_ms: 0 };
    trace.push(entry);
    if (toolCalls >= program.budget.toolCalls) {
      entry.status = 'budget_exhausted'; entry.error = 'Tool-call budget exhausted before invocation';
      throw new Error(entry.error);
    }
    toolCalls++;
    try {
      let returned;
      const handlerStarted = performance.now();
      try { returned = await handler.fn(snapshot); }
      finally { entry.elapsed_ms = performance.now() - handlerStarted; }
      const output = copyJson(returned);
      entry.output = output; entry.output_hash = hash(output); entry.status = 'ok';
      return freeze(copyJson(output));
    } catch (error) {
      entry.status = 'error'; entry.error = String(error?.message || error).slice(0, 2000);
      throw new Error(entry.error);
    }
  };
  const loop = await runCycle(branch.loop, {
    work: async context => {
      const observed = await invoke('observe', { ...context, state: branch.loop });
      exact(observed, ['reward', 'cost', 'evidence', ...(Object.hasOwn(observed, 'data') ? ['data'] : [])]);
      research = observed.data ?? null;
      return { reward: observed.reward, cost: observed.cost, evidence: observed.evidence };
    },
    proposeGoal: () => null,
    proposeProject: async context => {
      const proposed = await invoke('propose', context);
      if (proposed === null) return null;
      exact(proposed, ['project', 'rationale', 'evidence']);
      check(proposed.project && typeof proposed.project === 'object' && !Array.isArray(proposed.project) && text(proposed.rationale) &&
        Array.isArray(proposed.evidence) && proposed.evidence.length > 0 && proposed.evidence.every(text), 'Invalid proposal');
      execution = await invoke('execute', { ...context, project: proposed.project, proposal: proposed });
      exact(execution, ['project', 'result', 'evidence']);
      check(execution.project && typeof execution.project === 'object' && !Array.isArray(execution.project), 'Invalid executed project');
      check(Array.isArray(execution.evidence) && execution.evidence.length > 0 && execution.evidence.every(text), 'Execution requires evidence');
      return { ...proposed, project: execution.project, evidence: [...proposed.evidence, ...execution.evidence] };
    },
    evaluate: context => invoke('compare', { ...context, state: branch.loop }),
  });
  const cycle = loop.cycles.at(-1);
  const accepted = cycle.decisions.project === 'accepted';
  const retainedOutput = { accepted, decision: cycle.decisions.project, project_hash: hash(loop.project) };
  trace.push({ sequence: trace.length + 1, stage: 'retain', target: 'if-verified-better', input_hash: hash(cycle),
    output: retainedOutput, output_hash: hash(retainedOutput), status: accepted ? 'retained' : 'held', error: null });
  let graph = branch.graph;
  const programs = [...branch.programs];
  if (accepted) {
    const experience = { task: { id: `program-cycle-${cycle.hash}`, intent: typeof taskInput === 'string' && taskInput.trim() ? taskInput : program.goal },
      observation: { summary: `Executed ${inspected.hash} through registered observe/propose/execute/compare handlers.` },
      evidence: [ref('program', program), ref('trace', trace), ref('cycle', cycle)],
      verification: { passed: true, verifier: `host:${branch.adapter_id}`, command: 'runCycle fixed-case nonregression and strict gain', evidence: [ref('evaluation', cycle.evaluations)] },
      lesson: { summary: `Retain verified transition program for ${program.goal}`, action: `Execute program:${inspected.hash}`, terms: [program.goal] } };
    const episode = recordExperience(createRuliad({ purpose: loop.purpose }), experience);
    const lesson = episode.nodes.find(node => node.type === 'lesson');
    graph = recordExperience(graph, experience);
    programs.push(signed({ program_hash: inspected.hash, program, cycle_hash: cycle.hash, lesson_id: lesson.id }));
  }
  const receipt = signed({ kind: 'agent_os.transition_program_receipt.v1', program_hash: inspected.hash,
    before_loop_hash: branch.loop.hash, after_loop_hash: loop.hash, outcome: accepted ? 'retained' : 'held', cycle_hash: cycle.hash,
    decisions: cycle.decisions, error: cycle.error, trace, budget: program.budget,
    usage: { tool_calls: toolCalls, human_minutes: null, human_budget_enforced: false,
      elapsed_ms: performance.now() - started,
      handler_elapsed_ms: trace.reduce((total, entry) => total + (entry.elapsed_ms || 0), 0),
      input_bytes: Buffer.byteLength(JSON.stringify(taskInput), 'utf8') },
    output: execution?.result ?? null, project_hash: hash(loop.project), adapter_id: branch.adapter_id });
  const next = signed({ ...unsigned(branch), loop, graph, programs, receipts: [...branch.receipts, receipt] });
  return freeze({ branch: rememberOwned(next, ownedBranches.get(branch)), receipt });
}

function makeRoutingProgramAdapter({ observations } = {}) {
  const routing = makeRoutingAdapter(observations === undefined ? {} : { observations });
  return {
    id: 'agent_os.routing_program_adapter.v1', initial: ROUTING_INITIAL,
    operations: {
      observe: { 'research-and-repo': context => routing.work(context) },
      propose: { 'candidate-change': context => routing.proposeProject(context) },
      execute: { 'candidate-in-isolation': context => ({ project: context.project, result: routing.work(context), evidence: ['Candidate routing work executed against labelled observations.'] }) },
      compare: { baseline: context => routing.evaluate(context) },
    },
  };
}

module.exports = { createProgramBranch, inspectProgram, runTransitionProgram, makeRoutingProgramAdapter };
