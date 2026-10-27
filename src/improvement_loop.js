'use strict';

const { hash, freeze } = require('./core');
const SCHEMA = 'agent_os.improvement_loop.v1';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function check(ok, message) { if (!ok) throw new Error(message); }
function string(value) { return typeof value === 'string' && value.trim().length > 0; }
function positive(value) { return Number.isFinite(value) && value > 0; }
function score(value) { return Number.isFinite(value) && value >= 0 && value <= 1; }
function json(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isFinite(value), 'Non-finite JSON number'); return; }
  check(value && typeof value === 'object' && !seen.has(value), 'Expected acyclic plain JSON');
  const prototype = Object.getPrototypeOf(value);
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  check(Array.isArray(value) || prototype === null || (Object.getPrototypeOf(prototype) === null &&
    typeof constructor === 'function' && constructor.prototype === prototype &&
    Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object) &&
    !Object.getOwnPropertyDescriptor(prototype, 'toJSON')), 'Expected plain JSON object');
  seen.add(value);
  check(Object.getOwnPropertySymbols(value).length === 0, 'JSON symbols forbidden');
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    check(!forbidden.has(key), 'Unsafe JSON key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor.enumerable && 'value' in descriptor, 'JSON accessors forbidden');
    json(descriptor.value, seen);
  }
  if (Array.isArray(value)) check(Object.keys(value).length === value.length && Object.keys(value).every((key, i) => key === String(i)), 'Sparse or decorated array');
  seen.delete(value);
}
function copy(value) { json(value); return JSON.parse(JSON.stringify(value)); }
function keys(value, expected) {
  check(value && !Array.isArray(value) && typeof value === 'object', 'Expected record');
  check(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), 'Unexpected or missing fields');
}
function evidence(value) { check(Array.isArray(value) && value.length > 0 && value.every(string), 'Missing evidence'); }
function goal(value) {
  keys(value, ['id', 'description', 'priority']);
  check(string(value.id) && !forbidden.has(value.id) && string(value.description) && positive(value.priority), 'Invalid goal');
}
function project(value) { check(value && typeof value === 'object' && !Array.isArray(value), 'Invalid project'); }
function signed(value) { return freeze({ ...value, hash: hash(value) }); }
function unsigned(value) { const { hash: ignored, ...body } = value; return body; }
function stats(goals) { return goals.map(g => ({ id: g.id, revision: 0, attempts: 0, successes: 0, reward: 0, cost: 0 })); }
function configuration(value) {
  keys(value, ['goals', 'project', 'learning']);
  check(Array.isArray(value.goals) && value.goals.length > 0 && value.goals.length <= 64, 'Expected 1 to 64 goals');
  value.goals.forEach(goal);
  check(new Set(value.goals.map(g => g.id)).size === value.goals.length, 'Duplicate goals');
  project(value.project);
  check(Array.isArray(value.learning) && value.learning.length === value.goals.length, 'Invalid learning');
  value.learning.forEach((s, i) => {
    keys(s, ['id', 'revision', 'attempts', 'successes', 'reward', 'cost']);
    check(s.id === value.goals[i].id && [s.revision, s.attempts, s.successes].every(n => Number.isSafeInteger(n) && n >= 0), 'Invalid statistics');
    check(s.successes <= s.attempts && Number.isFinite(s.reward) && s.reward >= 0 && s.reward <= s.successes && Number.isFinite(s.cost) && s.cost >= 0 && (s.successes === 0 ? s.cost === 0 : s.cost > 0), 'Invalid statistics totals');
  });
}

function createLoop(input) {
  const { purpose, goals, project: configurationProject, evaluation_id } = copy(input);
  keys(input, ['purpose', 'goals', 'project', 'evaluation_id']);
  check(string(purpose) && string(evaluation_id), 'Missing purpose or evaluation_id');
  const genesis = { goals, project: configurationProject, learning: stats(goals) };
  configuration(genesis);
  return signed({ schema: SCHEMA, version: 1, purpose, evaluation_id,
    anchor_hash: hash({ purpose, evaluation_id }), genesis, ...genesis, cycles: [] });
}

function validateLoop(input) {
  const state = copy(input);
  keys(state, ['schema', 'version', 'purpose', 'evaluation_id', 'anchor_hash', 'genesis', 'goals', 'project', 'learning', 'cycles', 'hash']);
  check(state.schema === SCHEMA && state.version === 1 && string(state.purpose) && string(state.evaluation_id), 'Invalid loop schema/anchor');
  check(state.anchor_hash === hash({ purpose: state.purpose, evaluation_id: state.evaluation_id }), 'Invalid anchor');
  check(state.hash === hash(unsigned(state)), 'Loop integrity mismatch');
  configuration(state.genesis);
  configuration({ goals: state.goals, project: state.project, learning: state.learning });
  check(Array.isArray(state.cycles), 'Invalid cycles');
  let prior = signed({ ...unsigned(state), ...state.genesis, cycles: [] });
  for (const receipt of state.cycles) {
    keys(receipt, ['cycle', 'prior_hash', 'selected_goal', 'observation', 'proposals', 'evaluations', 'decisions', 'error', 'after', 'project_hash', 'hash']);
    check(receipt.hash === hash(unsigned(receipt)) && receipt.prior_hash === prior.hash && receipt.cycle === prior.cycles.length + 1, 'Cycle receipt integrity mismatch');
    goal(receipt.selected_goal);
    configuration(receipt.after);
    check(receipt.project_hash === hash(receipt.after.project), 'Project receipt mismatch');
    prior = signed({ ...unsigned(prior), ...receipt.after, cycles: [...prior.cycles, receipt] });
  }
  check(prior.hash === state.hash, 'State does not match cycle history');
  return freeze(state);
}

function choose(state) {
  // Explore each goal once; thereafter use bounded optimism around observed reward per cost.
  let best = null;
  let bestScore = -Infinity;
  state.goals.forEach((g, i) => {
    const s = state.learning[i];
    const utility = s.cost > 0 ? s.reward / s.cost : 0;
    const rank = s.attempts === 0 ? Infinity : g.priority * (utility + Math.min(1, Math.sqrt(Math.log(state.cycles.length + 2) / s.attempts)));
    if (rank > bestScore) { best = g; bestScore = rank; }
  });
  return best;
}
function selectGoal(state) { return choose(validateLoop(state)); }
function observation(value) {
  keys(value, ['reward', 'cost', 'evidence']);
  check(score(value.reward) && positive(value.cost), 'Invalid work reward/cost'); evidence(value.evidence);
}
function evaluation(value, id) {
  keys(value, ['evaluation_id', 'cases', 'evidence']);
  check(value.evaluation_id === id && Array.isArray(value.cases) && value.cases.length > 0, 'Evaluation anchor/cases mismatch');
  evidence(value.evidence);
  value.cases.forEach(c => { keys(c, ['id', 'score']); check(string(c.id) && score(c.score), 'Invalid evaluation case'); });
  check(new Set(value.cases.map(c => c.id)).size === value.cases.length, 'Duplicate evaluation cases');
}
function anchoredCases(state) {
  for (const receipt of state.cycles) {
    const incumbent = receipt.evaluations && receipt.evaluations.incumbent;
    try { evaluation(incumbent, state.evaluation_id); }
    catch { continue; }
    return incumbent.cases.map(c => c.id).sort();
  }
  return null;
}
function message(error) { return String(error && error.message || error); }

async function runCycle(input, adapter) {
  const state = validateLoop(input);
  check(adapter && ['work', 'proposeGoal', 'proposeProject', 'evaluate'].every(k => typeof adapter[k] === 'function'), 'Incomplete adapter');
  const selected = choose(state);
  const after = copy({ goals: state.goals, project: state.project, learning: state.learning });
  const record = { cycle: state.cycles.length + 1, prior_hash: state.hash, selected_goal: selected,
    observation: null, proposals: { goal: null, project: null }, evaluations: null,
    decisions: { goal: 'hold', project: 'hold' }, error: null };
  const learned = after.learning.find(s => s.id === selected.id);
  learned.attempts += 1;
  try {
    record.observation = copy(await adapter.work(freeze({ project: state.project, goal: selected, cycle: record.cycle })));
    observation(record.observation);
    learned.successes += 1;
    learned.reward += record.observation.reward;
    learned.cost += record.observation.cost;
    check(Number.isFinite(learned.cost) && Number.isFinite(learned.reward), 'Statistics overflow');
  } catch (error) {
    record.observation = null;
    Object.assign(learned, state.learning.find(s => s.id === selected.id), { attempts: learned.attempts });
    record.error = message(error);
    return finish(state, record, after);
  }
  const context = freeze({ state, goal: selected, observation: record.observation });
  const proposals = await Promise.allSettled([
    Promise.resolve().then(() => adapter.proposeGoal(context)),
    Promise.resolve().then(() => adapter.proposeProject(context)),
  ]);
  for (const [index, kind] of ['goal', 'project'].entries()) {
    try {
      if (proposals[index].status === 'rejected') throw proposals[index].reason;
      const proposed = copy(proposals[index].value);
      record.proposals[kind] = proposed;
      if (proposed === null) continue;
      if (kind === 'goal') {
        keys(proposed, ['id', 'description', 'priority', 'evidence']); evidence(proposed.evidence);
        const nextGoal = { id: proposed.id, description: proposed.description, priority: proposed.priority }; goal(nextGoal);
        const i = after.goals.findIndex(g => g.id === nextGoal.id);
        if (i < 0) {
          check(after.goals.length < 64, 'Goal limit of 64 reached');
          after.goals.push(nextGoal); after.learning.push(stats([nextGoal])[0]);
        }
        else {
          check(nextGoal.priority === after.goals[i].priority, 'Existing priority is operator controlled');
          if (nextGoal.description !== after.goals[i].description) after.learning[i] = { ...stats([nextGoal])[0], revision: after.learning[i].revision + 1 };
          after.goals[i] = nextGoal;
        }
        record.decisions.goal = 'admitted_for_trial';
      } else {
        keys(proposed, ['project', 'rationale', 'evidence']); project(proposed.project); evidence(proposed.evidence); check(string(proposed.rationale), 'Missing project rationale');
        const oldResult = copy(await adapter.evaluate(freeze({ project: state.project, evaluation_id: state.evaluation_id })));
        record.evaluations = { incumbent: oldResult, candidate: null };
        evaluation(oldResult, state.evaluation_id);
        const caseAnchor = anchoredCases(state);
        check(caseAnchor === null || hash(oldResult.cases.map(c => c.id).sort()) === hash(caseAnchor), 'Evaluation suite changed across cycles');
        const newResult = copy(await adapter.evaluate(freeze({ project: freeze(copy(proposed.project)), evaluation_id: state.evaluation_id })));
        record.evaluations.candidate = newResult;
        evaluation(newResult, state.evaluation_id);
        const byId = new Map(newResult.cases.map(c => [c.id, c.score]));
        check(oldResult.cases.length === byId.size && oldResult.cases.every(c => byId.has(c.id)), 'Evaluation case mismatch');
        check(oldResult.cases.every(c => byId.get(c.id) >= c.score), 'Evaluation regression');
        check(oldResult.cases.some(c => byId.get(c.id) > c.score), 'No strict evaluation gain');
        after.project = copy(proposed.project);
        record.decisions.project = 'accepted';
      }
    } catch (error) { record.decisions[kind] = `rejected: ${message(error)}`; }
  }
  return finish(state, record, after);
}
function finish(state, record, after) {
  const receipt = signed({ ...record, after, project_hash: hash(after.project) });
  return validateLoop(signed({ ...unsigned(state), ...after, cycles: [...state.cycles, receipt] }));
}
async function runLoop(input, adapter, { cycles = 1, onCycle } = {}) {
  check(Number.isInteger(cycles) && cycles >= 1 && cycles <= 20, 'cycles must be an integer from 1 to 20');
  check(onCycle === undefined || typeof onCycle === 'function', 'Invalid onCycle');
  let state = validateLoop(input);
  for (let i = 0; i < cycles; i += 1) {
    state = await runCycle(state, adapter);
    if (onCycle) await onCycle(state);
    if (state.cycles.at(-1).error) break;
  }
  return state;
}

module.exports = { createLoop, validateLoop, selectGoal, runCycle, runLoop, copyJson: copy };
