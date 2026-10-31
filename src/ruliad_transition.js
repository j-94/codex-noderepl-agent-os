'use strict';

const { hash, freeze } = require('./core');
const { createLoop, validateLoop, runCycle } = require('./improvement_loop');
const { ROUTING_INITIAL, makeRoutingAdapter, routeWithProject } = require('./improvement_routing');
const { createRuliad, validateRuliad, recordExperience, selectRmeCut } = require('./rme');

const KIND = 'agent_os.ruliad_transition.v1';
const trusted = new WeakSet();
const seal = body => freeze(JSON.parse(JSON.stringify({ ...body, hash: hash(body) })));
const bodyOf = value => { const { hash: ignored, ...body } = value; return body; };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ref = (kind, value) => ({ path: `mem://ruliad/${kind}/${hash(value)}`, sha256: hash(value) });

function createTransitionBranch() {
  const branch = seal({ kind: KIND, loop: createLoop(ROUTING_INITIAL),
    graph: createRuliad({ purpose: ROUTING_INITIAL.purpose }), capabilities: [], receipts: [] });
  trusted.add(branch);
  return branch;
}

function cycleProgram(cycle) {
  return { op: 'route', project: cycle.after.project };
}

function addedRule(loop, cycle) {
  const before = cycle.cycle === 1 ? loop.genesis.project : loop.cycles[cycle.cycle - 2].after.project;
  const rules = cycle.after.project.rules.filter(rule => !before.rules.some(old => hash(old) === hash(rule)));
  assert(rules.length === 1 && cycle.after.project.rules.length === before.rules.length + 1, 'Expected one retained rule');
  assert(before.rules.every((rule, index) => hash(rule) === hash(cycle.after.project.rules[index])), 'Prior rules changed');
  return { before, rule: rules[0] };
}

function experienceFor(cycle, rule) {
  const program = cycleProgram(cycle);
  return { task: { id: `routing-cycle-${cycle.hash}`, intent: rule.source.intent },
    observation: { summary: `Observed ${rule.source.actual}; labelled ${rule.source.expected}; cue ${rule.cue}.` },
    evidence: [ref('cycle', cycle), ref('program', program)],
    verification: { passed: true, verifier: 'host-fixed-routing-suite-v1', command: 'makeRoutingAdapter.evaluate: nonregression and strict gain', evidence: [ref('evaluation', cycle.evaluations)] },
    lesson: { summary: `Use retained ${rule.route} transition for ${rule.cue}.`, action: `Execute mem://ruliad/program/${hash(program)}`, terms: [rule.cue] } };
}

function validateTransitionBranch(branch) {
  if (trusted.has(branch)) return true;
  assert(branch?.kind === KIND && branch.hash === hash(bodyOf(branch)), 'Transition branch integrity failure');
  validateLoop(branch.loop); validateRuliad(branch.graph);
  assert(hash(branch.loop.genesis) === hash(createLoop(ROUTING_INITIAL).genesis) && branch.loop.purpose === ROUTING_INITIAL.purpose && branch.loop.evaluation_id === ROUTING_INITIAL.evaluation_id, 'Transition anchor mismatch');
  assert(Array.isArray(branch.capabilities) && Array.isArray(branch.receipts), 'Invalid transition collections');
  assert(new Set(branch.capabilities.map(cap => cap.source_cycle_hash)).size === branch.capabilities.length, 'Duplicate cycle capability');
  const accepted = branch.loop.cycles.filter(cycle => cycle.decisions.project === 'accepted');
  assert(accepted.length === branch.capabilities.length, 'Unbound accepted transition');
  const evaluator = makeRoutingAdapter();
  for (const cap of branch.capabilities) {
    assert(cap.hash === hash(bodyOf(cap)), 'Capability integrity failure');
    const cycle = accepted.find(item => item.hash === cap.source_cycle_hash);
    assert(cycle && hash(cap.program) === hash(cycleProgram(cycle)), 'Program/cycle linkage failure');
    const { before, rule } = addedRule(branch.loop, cycle);
    const incumbent = evaluator.evaluate({ project: before, evaluation_id: branch.loop.evaluation_id });
    const candidate = evaluator.evaluate({ project: cap.program.project, evaluation_id: branch.loop.evaluation_id });
    assert(hash(cycle.evaluations) === hash({ incumbent, candidate }), 'Host verification mismatch');
    assert(candidate.cases.every((item, index) => item.score >= incumbent.cases[index].score) && candidate.cases.some((item, index) => item.score > incumbent.cases[index].score), 'Host verification rejects transition');
    const expectedGraph = recordExperience(createRuliad({ purpose: ROUTING_INITIAL.purpose }), experienceFor(cycle, rule));
    const expectedLesson = expectedGraph.nodes.find(node => node.type === 'lesson');
    assert(cap.lesson_id === expectedLesson.id && expectedGraph.nodes.every(node => branch.graph.nodes.some(actual => actual.id === node.id)), 'Program/lesson lineage failure');
  }
  for (const receipt of branch.receipts) assert(receipt.hash === hash(bodyOf(receipt)), 'Transition receipt integrity failure');
  return true;
}

function finish(branch, patch, receipt) {
  const signedReceipt = seal({ ...receipt, before_hash: branch.hash });
  const next = seal({ ...bodyOf(branch), ...patch, receipts: [...branch.receipts, signedReceipt] });
  if (patch.loop || patch.graph || patch.capabilities) validateTransitionBranch(next);
  trusted.add(next);
  return freeze({ branch: next, receipt: signedReceipt });
}

async function learnTransition(branch, { observations } = {}) {
  validateTransitionBranch(branch);
  branch = seal(bodyOf(branch));
  const loop = await runCycle(branch.loop, makeRoutingAdapter(observations === undefined ? {} : { observations }));
  const cycle = loop.cycles.at(-1);
  let graph = branch.graph;
  const capabilities = [...branch.capabilities];
  let capability = null;
  if (cycle.decisions.project === 'accepted') {
    const { rule } = addedRule(loop, cycle);
    graph = recordExperience(graph, experienceFor(cycle, rule));
    const episode = recordExperience(createRuliad({ purpose: ROUTING_INITIAL.purpose }), experienceFor(cycle, rule));
    const lesson = episode.nodes.find(node => node.type === 'lesson');
    capability = seal({ program: cycleProgram(cycle), source_cycle_hash: cycle.hash, lesson_id: lesson.id });
    capabilities.push(capability);
  }
  return finish(branch, { loop, graph, capabilities }, { kind: 'agent_os.transition_learn.v1',
    outcome: capability ? 'promoted' : 'held', admission: cycle.decisions.project, cycle_hash: cycle.hash,
    capability_hash: capability?.hash || null, lesson_ids: capability ? [capability.lesson_id] : [] });
}

function executeTransition(branch, intent, { excludeLessonIds = [] } = {}) {
  validateTransitionBranch(branch);
  assert(typeof intent === 'string' && intent.trim(), 'A new task intent is required');
  const base = routeWithProject(intent, ROUTING_INITIAL.project);
  const receipt = { kind: 'agent_os.transition_execute.v1', input_hash: hash(intent), base,
    output: null, gate: 'hold', outcome: 'held', reason: 'no_applicable_capability', capability_hash: null, lesson_ids: [] };
  if (base.claim_or_effect_gate === 'effect') return finish(branch, {}, { ...receipt, reason: 'effect_requires_separate_admission' });
  const cut = selectRmeCut(branch.graph, { intent, maxNodes: 32, excludeLessonIds });
  for (const cap of [...branch.capabilities].reverse()) {
    if (!cut.lessonIds.includes(cap.lesson_id)) continue;
    const cycle = branch.loop.cycles.find(item => item.hash === cap.source_cycle_hash);
    const { rule } = addedRule(branch.loop, cycle);
    if (!new RegExp(`\\b${rule.cue}\\b`, 'i').test(intent)) continue;
    const output = routeWithProject(intent, cap.program.project);
    if (output.route === base.route || output.route !== rule.route || output.claim_or_effect_gate === 'effect') continue;
    return finish(branch, {}, { ...receipt, output, gate: output.claim_or_effect_gate, outcome: 'executed', reason: 'verified_retained_route', capability_hash: cap.hash, lesson_ids: [cap.lesson_id], cut_hash: cut.hash });
  }
  return finish(branch, {}, receipt);
}

module.exports = { createTransitionBranch, validateTransitionBranch, learnTransition, executeTransition };
