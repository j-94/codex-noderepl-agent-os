'use strict';

const crypto = require('crypto');

const ROUTES = Object.freeze(['answer', 'search', 'patch', 'prove', 'materialize']);

const ROUTE_PATTERNS = Object.freeze([
  {
    route: 'materialize',
    patterns: /\b(write|edit|create|delete|commit|stage|deploy|materialize|proceed|fix|build it|do it)\b/i,
  },
  {
    route: 'patch',
    patterns: /\b(code|patch|bug|test|failing|repo|file|implement|refactor|cli|command)\b/i,
  },
  {
    route: 'prove',
    patterns: /\b(prove|proof|benchmark|eval|evaluate|measure|compare|claim|receipt)\b/i,
  },
  {
    route: 'search',
    patterns: /\b(search|find|look up|history|prior|source|evidence|latest|web|research)\b/i,
  },
]);

const DEFAULT_PRIOR = Object.freeze({
  answer: 'answer-card',
  search: 'parallel sensors',
  patch: 'patch-card',
  prove: 'heldout eval',
  materialize: 'effect gate',
});

const SURFACE_RULES = Object.freeze([
  {
    surface: 'trace_coverage',
    patterns: /\b(trace|traces|session|sessions|cwd|working directory|input|inputs|output|outputs|tool call|tool calls)\b/i,
  },
  {
    surface: 'history_merge_distiller',
    patterns: /\b(history|prior|previous|lineage|old|older|we built|our work|codex)\b/i,
  },
  {
    surface: 'hot_graph',
    patterns: /\b(graph|memory|state|receipt|receipts|control|claim|gate|transition)\b/i,
  },
  {
    surface: 'hologram_search',
    patterns: /\b(repo|code|file|function|endpoint|surface|surfaces|disk|built|implementation)\b/i,
  },
  {
    surface: 'promoted_knowledge',
    patterns: /\b(product|direction|strongest|claim|primitive|invention|architecture|frontier|doctrine)\b/i,
  },
  {
    surface: 'web_search',
    patterns: /\b(web|latest|twitter|x\.com|current news|online)\b/i,
  },
]);

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeIntent(intent) {
  return String(intent || '').trim().replace(/\s+/g, ' ');
}

function selectRoute(intent) {
  const text = normalizeIntent(intent);
  for (const item of ROUTE_PATTERNS) {
    if (item.patterns.test(text)) return item.route;
  }
  return 'answer';
}

function scopeFor(route, intent) {
  const text = normalizeIntent(intent);
  const scope = [];
  if (/\bhistory|prior|memory|lineage|trace|traces|session|sessions|codex|our work|we built\b/i.test(text)) {
    scope.push('history');
  }
  if (/\bweb|latest|twitter|x\.com|current news|online\b/i.test(text)) scope.push('web');
  if (
    route === 'patch' ||
    route === 'materialize' ||
    /\brepo|file|test|code|endpoint|function|surface|surfaces|disk|built|implementation\b/i.test(text)
  ) {
    scope.push('repo');
  }
  if (route === 'prove' || /\bclaim|eval|receipt|receipts|proof|gate|transition\b/i.test(text)) {
    scope.push('receipts');
  }
  if (route === 'search' && scope.length === 0) scope.push('local');
  return Object.freeze([...new Set(scope)]);
}

function gateFor(route, intent) {
  const text = normalizeIntent(intent);
  if (route === 'materialize') return 'effect';
  if (route === 'prove' || /\bclaim|receipt|prove|evidence\b/i.test(text)) return 'claim';
  return 'none';
}

function evidenceNeeded(route, intent) {
  return route === 'search' || route === 'prove' || /\b(source|evidence|latest|history|verify)\b/i.test(intent);
}

function nextFor(route, gate) {
  if (gate === 'effect') return 'compile patch-card, require rollback/evidence/boundary before backend effect';
  if (gate === 'claim') return 'collect only missing evidence, then render bounded answer';
  if (route === 'search') return 'run selected sensors, then answer from excerpts/handles';
  if (route === 'patch') return 'emit patch-card with target files/tests/rollback';
  return 'answer directly from compact prior';
}

function surfacePlanFor(route, intent) {
  const text = normalizeIntent(intent);
  if (route === 'materialize') return Object.freeze(['effect_gate']);
  if (route === 'patch') return Object.freeze(['patch_card']);
  if (route === 'prove') return Object.freeze(['bvt_receipts', 'heldout_eval']);
  if (route !== 'search') return Object.freeze(['answer_card']);

  const surfaces = [];
  for (const rule of SURFACE_RULES) {
    if (rule.patterns.test(text)) surfaces.push(rule.surface);
  }
  if (surfaces.length === 0) surfaces.push('history_merge_distiller');
  if (!surfaces.includes('web_search')) surfaces.push('raw_retrieval_fallback');
  return Object.freeze([...new Set(surfaces)]);
}

function cacheKeyFor(card) {
  return `fast:${card.route}:${stableHash({
    intent: card.intent.toLowerCase(),
    scope: card.scope,
    gate: card.claim_or_effect_gate,
  }).slice(0, 16)}`;
}

function priorFor(route, priors = {}) {
  const configured = priors[route] || priors[`${route}:prior`];
  if (typeof configured === 'string') return configured;
  return DEFAULT_PRIOR[route] || 'route-card';
}

function fastRoute(intent, options = {}) {
  const normalized = normalizeIntent(intent);
  const route = ROUTES.includes(options.route) ? options.route : selectRoute(normalized);
  const scope = scopeFor(route, normalized);
  const gate = gateFor(route, normalized);
  const surfacePlan = surfacePlanFor(route, normalized);
  const card = {
    kind: 'agent_os.fast_context_route.v0',
    intent: normalized,
    route,
    cache_key: '',
    scope,
    surface_plan: surfacePlan,
    prior: priorFor(route, options.priors || {}),
    evidence_needed: evidenceNeeded(route, normalized),
    claim_or_effect_gate: gate,
    next: nextFor(route, gate),
    claim_boundary:
      'Thin routing card only; cache hits and route priors must be verified by task outcome before stronger claims.',
  };
  return Object.freeze({
    ...card,
    cache_key: cacheKeyFor(card),
  });
}

function routeBatch(intents, options = {}) {
  return Object.freeze((intents || []).map((intent) => fastRoute(intent, options)));
}

module.exports = {
  ROUTES,
  fastRoute,
  routeBatch,
  selectRoute,
  surfacePlanFor,
};
