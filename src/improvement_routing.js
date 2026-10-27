'use strict';

const { fastRoute } = require('./fast_context_router');

const EVALUATION_ID = 'routing-heldout-v1';
const PROJECT_SCHEMA = 'agent_os.routing_project.v1';
const ROUTING_TRAINING_CASES = Object.freeze([
  Object.freeze({ id: 'train-proof', intent: 'compare code latency against the baseline', expected: 'prove', cue: 'compare' }),
  Object.freeze({ id: 'train-history', intent: 'history of the repo migration', expected: 'search', cue: 'history' }),
]);
const ROUTING_EVALUATION_CASES = Object.freeze([
  Object.freeze({ id: 'eval-proof-code', intent: 'compare the code throughput across implementations', expected: 'prove' }),
  Object.freeze({ id: 'eval-proof-cli', intent: 'compare CLI reliability with the baseline', expected: 'prove' }),
  Object.freeze({ id: 'eval-history-test', intent: 'history behind the failing test investigation', expected: 'search' }),
  Object.freeze({ id: 'eval-history-command', intent: 'history of our command design decisions', expected: 'search' }),
  Object.freeze({ id: 'eval-effect-proof', intent: 'edit code then compare throughput', expected: 'materialize' }),
  Object.freeze({ id: 'eval-effect-history', intent: 'delete the history file', expected: 'materialize' }),
  Object.freeze({ id: 'eval-patch', intent: 'explain the code refactor plan', expected: 'patch' }),
  Object.freeze({ id: 'eval-answer', intent: 'explain the idea', expected: 'answer' }),
]);
const ROUTING_INITIAL = Object.freeze({
  purpose: 'Improve bounded Agent OS routing from labelled work while preserving effect gates.',
  evaluation_id: EVALUATION_ID,
  goals: Object.freeze([
    Object.freeze({ id: 'proof-routing', description: 'Route proof requests accurately.', priority: 1 }),
    Object.freeze({ id: 'history-routing', description: 'Route history requests accurately.', priority: 1 }),
  ]),
  project: Object.freeze({ schema: PROJECT_SCHEMA, rules: Object.freeze([]) }),
});

function normalize(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasCue(intent, cue) {
  return new RegExp(`\\b${cue}\\b`, 'i').test(intent);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}

function validateExample(example, source = false) {
  const keys = ['id', 'intent', 'expected', ...(source ? ['actual'] : ['cue'])];
  if (!exactKeys(example, keys) || typeof example.id !== 'string' || !example.id.trim() ||
      typeof example.intent !== 'string' || !example.intent.trim() ||
      !['prove', 'search'].includes(example.expected) || fastRoute(example.intent).route !== 'patch') {
    throw new Error('Invalid labelled routing observation');
  }
  if (source ? example.actual !== 'patch' :
    typeof example.cue !== 'string' || !/^[a-z]{2,24}$/.test(example.cue) || !hasCue(example.intent, example.cue)) {
    throw new Error('Invalid routing cue or observed failure');
  }
  if (ROUTING_EVALUATION_CASES.some((item) => item.id === example.id || normalize(item.intent) === normalize(example.intent))) {
    throw new Error('Training observations must be independent of evaluation cases');
  }
}

function validateProject(project) {
  if (!exactKeys(project, ['schema', 'rules']) || project.schema !== PROJECT_SCHEMA ||
      !Array.isArray(project.rules) || project.rules.length > 100) {
    throw new Error('Invalid routing project');
  }
  const cues = new Set();
  for (const rule of project.rules) {
    if (!exactKeys(rule, ['cue', 'route', 'source']) || typeof rule.cue !== 'string' ||
        !/^[a-z]{2,24}$/.test(rule.cue) || !['prove', 'search'].includes(rule.route) || cues.has(rule.cue)) {
      throw new Error('Invalid learned routing rule');
    }
    validateExample(rule.source, true);
    if (rule.source.expected !== rule.route || !hasCue(rule.source.intent, rule.cue)) {
      throw new Error('Learned rule must be supported by its labelled failure');
    }
    cues.add(rule.cue);
  }
  return project;
}

function routeWithProject(intent, project) {
  validateProject(project);
  const base = fastRoute(intent);
  if (base.route !== 'patch' || base.claim_or_effect_gate === 'effect') return base;
  const rule = project.rules.find((candidate) => hasCue(base.intent, candidate.cue));
  return rule ? fastRoute(intent, { route: rule.route }) : base;
}

function makeRoutingAdapter({ observations = ROUTING_TRAINING_CASES } = {}) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 100) {
    throw new Error('Expected 1..100 labelled routing observations');
  }
  const ids = new Set();
  const training = observations.map((example) => {
    validateExample(example);
    if (ids.has(example.id)) throw new Error('Duplicate routing observation id');
    ids.add(example.id);
    return Object.freeze({ ...example });
  });
  const outcomesFor = (project, goal) => {
    validateProject(project);
    const scope = /^(proof|history)-routing(?::([a-z]{2,24}))?$/.exec(goal.id);
    if (!scope) throw new Error('Invalid routing goal scope');
    const expected = scope[1] === 'proof' ? 'prove' : 'search';
    const cue = scope[2];
    return training.filter((item) => item.expected === expected && (!cue || item.cue === cue)).map((item) => ({
      ...item, actual: routeWithProject(item.intent, project).route,
    }));
  };
  const failuresFor = (state, goal) => outcomesFor(state.project, goal).filter((item) => item.actual !== item.expected);
  return {
    work({ project, goal }) {
      const outcomes = outcomesFor(project, goal);
      const correct = outcomes.filter((item) => item.actual === item.expected).length;
      return {
        reward: outcomes.length ? correct / outcomes.length : 0,
        cost: Math.max(1, outcomes.length),
        evidence: outcomes.length ? outcomes.map((item) => `${item.id}: expected=${item.expected}, actual=${item.actual}`) :
          ['No labelled work observations match this goal.'],
      };
    },
    proposeGoal({ state, goal }) {
      const goalId = (failure) => `${failure.expected === 'prove' ? 'proof' : 'history'}-routing:${failure.cue}`;
      const failure = failuresFor(state, goal).find((item) => !state.goals.some((existing) => existing.id === goalId(item)));
      if (!failure) return null;
      const description = `Resolve ${failure.expected} requests containing "${failure.cue}" that code vocabulary routes to patch.`;
      return {
        id: goalId(failure), description, priority: goal.priority,
        evidence: [`${failure.id}: observed ${failure.actual}; labelled ${failure.expected}; cue=${failure.cue}`],
      };
    },
    proposeProject({ state, goal }) {
      const failure = failuresFor(state, goal).find((item) => item.actual === 'patch' &&
        !state.project.rules.some((rule) => rule.cue === item.cue));
      if (!failure || state.project.rules.length >= 100) return null;
      const source = { id: failure.id, intent: failure.intent, expected: failure.expected, actual: failure.actual };
      return {
        project: {
          schema: PROJECT_SCHEMA,
          rules: [...state.project.rules, { cue: failure.cue, route: failure.expected, source }],
        },
        rationale: `Use the labelled cue "${failure.cue}" to resolve this observed patch ambiguity.`,
        evidence: [`${failure.id}: expected=${failure.expected}, actual=${failure.actual}`],
      };
    },
    evaluate({ project, evaluation_id }) {
      if (evaluation_id !== EVALUATION_ID) throw new Error('Unknown routing evaluation id');
      validateProject(project);
      const actual = ROUTING_EVALUATION_CASES.map((item) => ({ ...item, card: routeWithProject(item.intent, project) }));
      return {
        evaluation_id,
        cases: actual.map((item) => ({ id: item.id, score: Number(item.card.route === item.expected) })),
        evidence: actual.map((item) => `${item.id}: expected=${item.expected}, actual=${item.card.route}, gate=${item.card.claim_or_effect_gate}`),
      };
    },
  };
}

module.exports = {
  ROUTING_INITIAL,
  ROUTING_TRAINING_CASES,
  ROUTING_EVALUATION_CASES,
  makeRoutingAdapter,
  routeWithProject,
};
