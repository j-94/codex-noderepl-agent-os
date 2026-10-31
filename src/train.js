'use strict';

const fs = require('fs');
const { init, readMem, run, snapshot } = require('./core');
const { unityPacket } = require('./language');
const { memfs } = require('./tools');

const TRAINING_KEY = 'train/events.v0';
const PRIORS_KEY = 'train/priors.v0';

const REWARD = Object.freeze({
  user_accepted: 1,
  test_passed: 1,
  corrected: -1,
  user_corrected: -1,
  test_failed: -1,
  held: 0.25,
  unknown: 0,
});

function normalizeOutcome(outcome) {
  return Object.prototype.hasOwnProperty.call(REWARD, outcome) ? outcome : 'unknown';
}

function rewardFor(outcome) {
  return REWARD[normalizeOutcome(outcome)];
}

function rowIntent(row) {
  return row.intent || row.objective || row.prompt || row.title || row.summary || '';
}

function learnEvent(row, options = {}) {
  const outcome = normalizeOutcome(row.outcome || options.outcome);
  const packet = unityPacket({
    intent: rowIntent(row),
    state: row.state || 'history row',
    delta: row.delta || row.action || row.next || 'route/gate/speech prior update',
    constraint: row.constraint || 'learn from outcome without materializing effects',
    next_state: row.next_state || 'updated external priors',
    decision: row.decision || (rewardFor(outcome) < 0 ? 'hold' : 'shadow'),
    claim_boundary: row.claim_boundary || 'training tape row only; not model-weight learning',
    control: row.control || {},
  });
  return Object.freeze({
    kind: 'agent_os.training_event.v0',
    id: row.id || packet.carrier.hash,
    source: row.source || options.source || 'live',
    outcome,
    reward: rewardFor(outcome),
    route: packet.vsm.id,
    verb: packet.verb,
    gate: packet.gate.decision,
    bitmask: packet.carrier.bitmask,
    prime_product: packet.carrier.prime_product,
    packet_hash: packet.carrier.hash,
    packet,
  });
}

function emptyPriors() {
  return {
    kind: 'agent_os.training_priors.v0',
    rows: 0,
    reward_sum: 0,
    route: {},
    gate: {},
    speech: {},
  };
}

function bump(bucket, key, reward) {
  const current = bucket[key] || { n: 0, reward: 0 };
  bucket[key] = Object.freeze({
    n: current.n + 1,
    reward: current.reward + reward,
  });
}

function precomputePriors(events) {
  const priors = emptyPriors();
  for (const event of events) {
    priors.rows += 1;
    priors.reward_sum += event.reward;
    bump(priors.route, `${event.route}:${event.verb}`, event.reward);
    bump(priors.gate, event.gate, event.reward);
    bump(priors.speech, event.outcome, event.reward);
  }
  return Object.freeze({
    ...priors,
    route: Object.freeze(priors.route),
    gate: Object.freeze(priors.gate),
    speech: Object.freeze(priors.speech),
  });
}

function trainTape(rows, options = {}) {
  const events = Object.freeze(rows.map((row) => learnEvent(row, options)));
  const priors = precomputePriors(events);
  const machine = run(init(), [
    memfs.write(TRAINING_KEY, events),
    memfs.write(PRIORS_KEY, priors),
  ]);
  return Object.freeze({
    kind: 'agent_os.training_run.v0',
    events,
    priors,
    machine: snapshot(machine),
    events_hash: readMem(machine, TRAINING_KEY).hash,
    priors_hash: readMem(machine, PRIORS_KEY).hash,
    receipts: machine.receipts.length,
    claim_boundary: 'Realtime/previous-history training updates external tape priors only; no model weights are changed.',
  });
}

function parseRows(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return rowsFromJson(JSON.parse(trimmed));
    } catch (error) {
      // JSONL commonly starts with "{" but contains one JSON object per line.
    }
  }
  return trimmed
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['records', 'rows', 'sessions', 'packets', 'events']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.values(value).flatMap((item) => (Array.isArray(item) ? item : []));
}

function trainFromFile(path, options = {}) {
  const rows = parseRows(fs.readFileSync(path, 'utf8')).slice(0, options.limit || Infinity);
  return trainTape(rows, { ...options, source: options.source || path });
}

module.exports = {
  PRIORS_KEY,
  TRAINING_KEY,
  learnEvent,
  parseRows,
  precomputePriors,
  rewardFor,
  rowsFromJson,
  trainFromFile,
  trainTape,
};
