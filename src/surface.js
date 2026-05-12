'use strict';

const { O, freeze } = require('./core');

const M = Object.freeze({
  LATENCY: 0,
  EVIDENCE: 1,
  SAFETY: 2,
  RECEIPT: 3,
  WEIGHT: 4,
});

const DEFAULT_WEIGHTS = Object.freeze([-1, 1, 1, 1, -1]);

function surface(ops, metrics, call = null) {
  return freeze({
    ops: freeze([...ops]),
    metrics: freeze([...metrics]),
    call,
  });
}

function supports(item, op) {
  return item.ops.includes(op);
}

function score(item, weights = DEFAULT_WEIGHTS) {
  return item.metrics.reduce((sum, value, index) => sum + value * (weights[index] || 0), 0);
}

function dominates(a, b) {
  const betterOrEqual = a.metrics.every((value, index) => {
    if (index === M.LATENCY || index === M.WEIGHT) return value <= b.metrics[index];
    return value >= b.metrics[index];
  });
  const strictlyBetter = a.metrics.some((value, index) => {
    if (index === M.LATENCY || index === M.WEIGHT) return value < b.metrics[index];
    return value > b.metrics[index];
  });
  return betterOrEqual && strictlyBetter;
}

function frontier(items) {
  return freeze(items.filter((item) => !items.some((other) => other !== item && dominates(other, item))));
}

function choose(items, op, weights = DEFAULT_WEIGHTS) {
  const candidates = frontier(items.filter((item) => supports(item, op)));
  return candidates.sort((a, b) => score(b, weights) - score(a, weights))[0] || null;
}

function builtins() {
  return freeze([
    surface([O.OBSERVE, O.SELECT], [1, 1, 1, 1, 1]),
    surface([O.TRANSFORM], [1, 1, 1, 1, 1]),
    surface([O.GATE], [2, 2, 3, 3, 2]),
    surface([O.COMMIT], [3, 2, 2, 3, 2]),
    surface([O.RECEIPT], [1, 3, 2, 3, 1]),
  ]);
}

module.exports = {
  DEFAULT_WEIGHTS,
  M,
  builtins,
  choose,
  dominates,
  frontier,
  score,
  surface,
  supports,
};
