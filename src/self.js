'use strict';

const { init, readMem, run, snapshot } = require('./core');
const { unityPacket } = require('./language');
const { memexec, memfs } = require('./tools');

const SELF_KEY = 'self/unity.kernel.packet.v0';
const CODEX_KEY = 'self/codex.capsule.v0';

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
  const codex = codexCapsule(packet, options);
  const machine = run(init(), [
    memfs.write(SELF_KEY, packet),
    memfs.write(CODEX_KEY, codex),
    memexec.plan(options.testCommand || ['npm', 'test']),
  ]);
  const stored = readMem(machine, SELF_KEY);
  const codexStored = readMem(machine, CODEX_KEY);
  return Object.freeze({
    kind: 'agent_os.self_plan.v0',
    packet,
    codex,
    machine: snapshot(machine),
    stored_hash: stored ? stored.hash : null,
    codex_hash: codexStored ? codexStored.hash : null,
    effects_held: machine.effects.length,
    receipts: machine.receipts.length,
    next: codex.next_action,
  });
}

function codexCapsule(packet, options = {}) {
  const materialization = packet.gate.decision === 'admit'
    ? 'materialize only through the admitted backend after tests'
    : 'hold effects; produce a patch plan or virtual diff only';
  return Object.freeze({
    kind: 'codex.capsule.v0',
    say: `Use ${packet.kind}: ${packet.intent}`,
    control_stream: [
      `VL1 I=${packet.intent} B=${packet.carrier.bitmask} P=${packet.carrier.prime_product} A=${packet.vsm.id}:${packet.verb}`,
      `${packet.transition.S} + ${packet.transition.delta} + ${packet.transition.C} -> ${packet.transition.S_prime}`,
      `gate=${packet.gate.decision} band=${packet.band} hash=${packet.carrier.hash}`,
    ],
    codex_rules: Object.freeze([
      'answer from the packet before broad search',
      'treat files, shell, git, and network as backend effects',
      'do not write unless rollback, evidence, claim boundary, and receipt are present',
      'run the planned verification command before claiming success',
    ]),
    forbidden_defaults: Object.freeze([
      'generic prose plan without a packet',
      'direct file mutation before gate',
      'new doctrine files when a small language patch is enough',
      'success claim without test or receipt',
    ]),
    next_action: options.next_action || `${materialization}; planned verification: ${(options.testCommand || ['npm', 'test']).join(' ')}`,
    claim_boundary: packet.gate.claim_boundary,
  });
}

module.exports = {
  CODEX_KEY,
  SELF_KEY,
  codexCapsule,
  selfPacket,
  selfPlan,
};
