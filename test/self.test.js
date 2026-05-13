'use strict';

const assert = require('assert');
const { SELF_KEY, selfPacket, selfPlan } = require('../src/self');

{
  const packet = selfPacket('improve the language without increasing complexity');
  assert.strictEqual(packet.kind, 'unity.kernel.packet.v0');
  assert.strictEqual(packet.gate.decision, 'hold');
  assert.strictEqual(packet.vsm.id, 'S3');
  assert.strictEqual(packet.carrier.hash.length, 64);
}

{
  const plan = selfPlan('add a narrow recursive check');
  assert.strictEqual(plan.kind, 'agent_os.self_plan.v0');
  assert.strictEqual(plan.machine.mem[0][0], SELF_KEY);
  assert.strictEqual(plan.machine.effects.length, 1);
  assert.deepStrictEqual(plan.machine.effects[0].data.argv, ['npm', 'test']);
  assert.strictEqual(plan.receipts, 2);
  assert.strictEqual(typeof plan.stored_hash, 'string');
}

{
  const plan = selfPlan('materialize a guarded self patch', {
    effect: true,
    rollback: 'revert branch diff',
    claim_boundary: 'local patch only',
    evidence: ['green tests'],
    control: { evidence_deficit: 0.1 },
  });
  assert.strictEqual(plan.packet.gate.decision, 'admit');
  assert.strictEqual(plan.packet.band, 'f3');
}

console.log('self recursion test: ok');
