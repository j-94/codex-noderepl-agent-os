'use strict';

const crypto = require('crypto');

const K = Object.freeze({
  BOOT: Symbol(),
  TICK: Symbol(),
  READ: Symbol(),
  WRITE: Symbol(),
  PLAN: Symbol(),
  EFFECT: Symbol(),
  ADMIT: Symbol(),
  HALT: Symbol(),
});

const O = Object.freeze({
  OBSERVE: Symbol(),
  SELECT: Symbol(),
  TRANSFORM: Symbol(),
  GATE: Symbol(),
  COMMIT: Symbol(),
  RECEIPT: Symbol(),
});

const ALPHABET = Object.freeze([...Object.values(K), ...Object.values(O)]);

function hash(value) {
  return crypto
    .createHash('sha256')
    .update(stable(value))
    .digest('hex');
}

function stable(value) {
  if (typeof value === 'symbol') return JSON.stringify(ALPHABET.indexOf(value));
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

function cell(kind, data = null) {
  return freeze({ kind, data });
}

function init(policy = defaultPolicy) {
  return freeze({
    head: 0,
    tape: [cell(K.BOOT)],
    mem: [],
    effects: [],
    receipts: [],
    halted: false,
    policy,
  });
}

function readMem(state, key) {
  const hit = [...state.mem].reverse().find(([path]) => path === key);
  return hit ? hit[1] : null;
}

function writeMem(state, key, value) {
  const blob = freeze({ value, hash: hash(value) });
  return freeze([...state.mem.filter(([path]) => path !== key), freeze([key, blob])]);
}

function append(state, event, patch) {
  const next = freeze({
    ...state,
    ...patch,
    head: state.head + 1,
    tape: freeze([...state.tape, event]),
  });
  return freeze({
    ...next,
    receipts: freeze([...next.receipts, receipt(state, event, next)]),
  });
}

function receipt(before, event, after) {
  return freeze({
    op: O.RECEIPT,
    before: hash(snapshot(before)),
    event: hash(event),
    after: hash(snapshot(after)),
    head: after.head,
  });
}

function snapshot(state) {
  return {
    head: state.head,
    tape: state.tape,
    mem: state.mem,
    effects: state.effects,
    halted: state.halted,
  };
}

function defaultPolicy(state, event) {
  if (state.halted) return cell(K.HALT);
  if (!event || !Object.values(K).includes(event.kind)) return cell(K.HALT);
  if (event.kind === K.EFFECT) return cell(K.HALT);
  return event;
}

function step(state, event) {
  const selected = state.policy(state, event);
  switch (selected.kind) {
    case K.TICK:
      return append(state, selected, {});
    case K.READ:
      return append(state, selected, {
        effects: freeze([...state.effects, cell(K.READ, readMem(state, selected.data.key))]),
      });
    case K.WRITE:
      return append(state, selected, {
        mem: writeMem(state, selected.data.key, selected.data.value),
      });
    case K.PLAN:
      return append(state, selected, {
        effects: freeze([...state.effects, selected]),
      });
    case K.ADMIT:
      return append(state, selected, {
        effects: freeze([...state.effects, selected]),
      });
    case K.HALT:
    default:
      return append(state, cell(K.HALT), { halted: true });
  }
}

function run(state, events, limit = Infinity) {
  let current = state;
  for (const event of events.slice(0, limit)) {
    current = step(current, event);
    if (current.halted) break;
  }
  return current;
}

function op(kind, data) {
  return cell(kind, data);
}

module.exports = {
  K,
  O,
  cell,
  defaultPolicy,
  freeze,
  hash,
  init,
  op,
  readMem,
  run,
  snapshot,
  stable,
  step,
};
