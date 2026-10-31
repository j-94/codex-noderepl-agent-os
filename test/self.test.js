'use strict';

const assert = require('assert');
const { CODEX_KEY, SELF_KEY, codexCapsule, selfPacket, selfPlan } = require('../src/self');

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
  assert.strictEqual(plan.machine.mem[1][0], CODEX_KEY);
  assert.strictEqual(plan.machine.effects.length, 1);
  assert.deepStrictEqual(plan.machine.effects[0].data.argv, ['npm', 'test']);
  assert.strictEqual(plan.receipts, 3);
  assert.strictEqual(typeof plan.stored_hash, 'string');
  assert.strictEqual(typeof plan.codex_hash, 'string');
  assert.strictEqual(plan.codex.kind, 'codex.capsule.v0');
  assert.strictEqual(plan.codex.control_stream.length, 3);
  assert.ok(plan.codex.codex_rules.includes('answer from the packet before broad search'));
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
  assert.ok(plan.codex.next_action.includes('materialize only through the admitted backend'));
}

{
  const capsule = codexCapsule(selfPacket('talk to Codex in a smaller packet'));
  assert.ok(capsule.say.includes('unity.kernel.packet.v0'));
  assert.ok(capsule.forbidden_defaults.includes('direct file mutation before gate'));
}

console.log('self recursion test: ok');
