'use strict';

const { init, readMem, run, snapshot } = require('./core');
const { unityPacket } = require('./language');
const { memexec, memfs } = require('./tools');

const SELF_KEY = 'self/unity.kernel.packet.v0';

function selfPacket(intent, options = {}) {
  return unityPacket({
    intent,
    state: options.state || 'Agent OS v2 language/runtime/test state',
    delta: options.delta || 'bounded self-recursion plan',
    constraint: options.constraint || 'virtualize first; require rollback, evidence, claim boundary, and tests before materialization',
    next_state: options.next_state || 'self-change remains held until admitted',
    effect: Boolean(options.effect),
    rollback: options.rollback || '',
    claim_boundary: options.claim_boundary || 'protocol-level self-recursion plan only; not autonomous sealed self-modification',
    evidence: options.evidence || [],
    control: {
      uncertainty: 0.45,
      evidence_deficit: options.effect ? 0.35 : 0.55,
      contradiction_pressure: 0.1,
      budget: 0.8,
      latency_pressure: 0.2,
      novelty_demand: 0.4,
      ...(options.control || {}),
    },
  });
}

function selfPlan(intent, options = {}) {
  const packet = selfPacket(intent, options);
  const machine = run(init(), [
    memfs.write(SELF_KEY, packet),
    memexec.plan(options.testCommand || ['npm', 'test']),
  ]);
  const stored = readMem(machine, SELF_KEY);
  return Object.freeze({
    kind: 'agent_os.self_plan.v0',
    packet,
    machine: snapshot(machine),
    stored_hash: stored ? stored.hash : null,
    effects_held: machine.effects.length,
    receipts: machine.receipts.length,
    next: 'Review packet, run tests, and materialize only through a gated backend if admitted.',
  });
}

module.exports = {
  SELF_KEY,
  selfPacket,
  selfPlan,
};
