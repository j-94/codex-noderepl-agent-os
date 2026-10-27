'use strict';

const assert = require('node:assert');
const { loadLmConfig, runLmLoop } = require('../src/lm_loop');

console.log('[TEST] Starting LM Loop Engine (Meta-Loop) verification...');

// 1. Verify Config-Driven Profile Loading
const config = loadLmConfig();
assert.ok(config.profiles);
assert.ok(config.profiles.quad_stack);
assert.strictEqual(config.profiles.quad_stack.thinking, 'low');
assert.strictEqual(config.profiles.quad_stack.provider, 'xai');

// 2. Test Single-Shot Successful Loop
(async () => {
  const res1 = await runLmLoop({
    goal: 'Verify basic arithmetic execution',
    profileName: 'fast',
    testCommand: 'node -e "process.exit(0)"',
    maxIterations: 2,
    mockProposer: async () => 'process.exit(0)'
  });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.trajectory.length, 1);
  assert.strictEqual(res1.receipt.kind, 'agent_os.lm_loop_receipt.v1');
  assert.strictEqual(res1.receipt.profile, 'fast');

  // 3. Test Anti-Recursion Tripwire Halt on Static Failure Loop
  const res2 = await runLmLoop({
    goal: 'Demonstrate static failure loop prevention',
    profileName: 'fast',
    testCommand: 'node -e "console.error(\'StaticSyntaxError\'); process.exit(1)"',
    maxIterations: 5,
    mockProposer: async () => 'broken_code_attempt'
  });

  assert.strictEqual(res2.success, false);
  assert.strictEqual(res2.tripped, true);
  assert.ok(res2.reason.includes('TRIPWIRE_HOLD'));
  // Must have halted at iteration 3 rather than burning all 5 iterations
  assert.strictEqual(res2.iterations, 3);

  // 4. Test Headless On-Tape State Loop (No Test Command)
  const res3 = await runLmLoop({
    goal: 'Emit on-tape headless plan transition',
    profileName: 'quad_stack',
    maxIterations: 1,
    mockProposer: async () => 'Commit state mutation on-tape'
  });

  assert.strictEqual(res3.success, true);
  assert.strictEqual(res3.receipt.success, true);

  console.log('ALL LM LOOP ENGINE (META-LOOP) TESTS PASS (100% OK)');
})().catch(err => {
  console.error('LM Loop Test Failed:', err);
  process.exit(1);
});
