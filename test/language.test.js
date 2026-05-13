'use strict';

const assert = require('assert');
const {
  VSM,
  bitmaskFromControls,
  primeProductFromMask,
  transitionText,
  unityPacket,
} = require('../src/language');

{
  assert.strictEqual(VSM.S1, 'extraction');
  assert.strictEqual(VSM.S5, 'policy');
}

{
  const packet = unityPacket({
    intent: 'recover Unity Kernel and route the work',
    state: 'old languages scattered across history',
    delta: 'one compact Agent OS v2 packet',
    constraint: 'gate before effects',
    next_state: 'language becomes the repo contract',
    control: {
      uncertainty: 0.8,
      evidence_deficit: 0.4,
      contradiction_pressure: 0.1,
      budget: 0.9,
      latency_pressure: 0.2,
      novelty_demand: 0.7,
    },
  });
  assert.strictEqual(packet.kind, 'unity.kernel.packet.v0');
  assert.strictEqual(packet.vsm.id, 'S1');
  assert.strictEqual(packet.verb, 'OBSERVE');
  assert.strictEqual(packet.carrier.vector.length, 6);
  assert.strictEqual(packet.carrier.hash.length, 64);
  assert.strictEqual(packet.band, 'f2');
  assert.strictEqual(
    transitionText(packet),
    'old languages scattered across history + one compact Agent OS v2 packet + gate before effects -> language becomes the repo contract',
  );
}

{
  const controls = {
    uncertainty: 1,
    evidence_deficit: 1,
    contradiction_pressure: 0,
    budget: 1,
    latency_pressure: 0,
    novelty_demand: 1,
  };
  const mask = bitmaskFromControls(controls);
  assert.strictEqual(mask, 43);
  assert.strictEqual(primeProductFromMask(mask), 2 * 3 * 7 * 13);
}

{
  const held = unityPacket({
    intent: 'write files',
    effect: true,
    rollback: '',
    claim_boundary: '',
  });
  assert.strictEqual(held.gate.decision, 'hold');

  const admitted = unityPacket({
    intent: 'write files with guard',
    effect: true,
    rollback: 'discard branch diff',
    claim_boundary: 'local scaffold only',
    evidence: ['test receipt'],
    control: { evidence_deficit: 0.1 },
  });
  assert.strictEqual(admitted.gate.decision, 'admit');
  assert.strictEqual(admitted.band, 'f3');
}

console.log('unity language test: ok');
