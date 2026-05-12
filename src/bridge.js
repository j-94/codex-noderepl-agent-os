'use strict';

const { hash } = require('./core');

function admitAll() {
  return false;
}

function dryBackend(effect) {
  return {
    ok: true,
    dry: true,
    effect,
  };
}

function bridge(machine, admit = admitAll, backend = dryBackend) {
  const results = [];
  for (const effect of machine.effects) {
    if (!admit(effect, machine)) {
      results.push({
        ok: false,
        held: true,
        effect: hash(effect),
      });
      continue;
    }
    const output = backend(effect, machine);
    results.push({
      ok: Boolean(output && output.ok),
      held: false,
      effect: hash(effect),
      output,
    });
  }
  return Object.freeze({
    machine: hash(machine),
    results: Object.freeze(results),
  });
}

function byCapability(allowed) {
  const allow = new Set(allowed);
  return (effect) => {
    const data = effect && effect.data;
    if (!data || typeof data !== 'object') return false;
    const [capability] = Object.keys(data);
    return allow.has(capability);
  };
}

module.exports = {
  bridge,
  byCapability,
  dryBackend,
};
