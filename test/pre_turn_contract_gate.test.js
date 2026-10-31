'use strict';

const assert = require('node:assert');
const { evalContractGate } = require('../src/contract_gate');

// 1. Read-only operation admitted without mutation contract
const r1 = evalContractGate({ isMutating: false });
assert.strictEqual(r1.decision, 'admit');
assert.strictEqual(r1.rule, 'read_only_pass');

// 2. Mutating action without teleological intent held (CONTRACT_HOLD)
const r2 = evalContractGate({
  isMutating: true,
  teleologicalIntent: '',
  witnessCriteria: 'npm test'
});
assert.strictEqual(r2.decision, 'hold');
assert.strictEqual(r2.rule, 'X_11_violation');
assert.ok(r2.reason.includes('CONTRACT_HOLD'));

// 3. Mutating action without witness criteria held (CONTRACT_HOLD)
const r3 = evalContractGate({
  isMutating: true,
  teleologicalIntent: 'Refactor parser',
  witnessCriteria: ''
});
assert.strictEqual(r3.decision, 'hold');
assert.strictEqual(r3.rule, 'X_11_violation');
assert.ok(r3.reason.includes('without declared physical witness criteria'));

// 4. Mutating action with valid contract admitted
const r4 = evalContractGate({
  isMutating: true,
  teleologicalIntent: 'Refactor parser to support AST bounds',
  witnessCriteria: 'exit 0 on parser.test.js'
});
assert.strictEqual(r4.decision, 'admit');
assert.strictEqual(r4.rule, 'X_11_compliant');

// 5. Turn completion with zero state delta held (ZERO_DELTA_HOLD)
const r5 = evalContractGate({
  isTurnComplete: true,
  stateDelta: 0
});
assert.strictEqual(r5.decision, 'hold');
assert.strictEqual(r5.rule, 'X_12_violation');
assert.ok(r5.reason.includes('ZERO_DELTA_HOLD'));

// 6. Turn completion with positive state delta admitted
const r6 = evalContractGate({
  isTurnComplete: true,
  stateDelta: 3
});
assert.strictEqual(r6.decision, 'admit');
assert.strictEqual(r6.rule, 'X_12_compliant');

console.log('pre_turn_contract_gate: ALL TESTS PASS');
