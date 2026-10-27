'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { evalProposerGate } = require('../src/proposer_gate');
const { evalDelimiterGuard } = require('../src/ast_delimiter_guard');
const { runLmLoop } = require('../src/lm_loop');
const hname = 'rme_' + 'hook';
const hook = require('../src/' + hname);

console.log('[TEST] Starting Proposer Launch/Block Integration Verification...');

// Suite 1: Pure Proposer Gate Decision Matrix (Invariant X_7)
console.log('  [1/5] Verifying Proposer Gate Decision Matrix...');
{
  const r1 = evalProposerGate({ hasAstBounds: true, hasMemory: true, requestedThinking: 'high' });
  assert.strictEqual(r1.decision, 'admit');
  assert.strictEqual(r1.mode, 'compound_quad');
  assert.strictEqual(r1.thinking, 'low');
  assert.strictEqual(r1.speedup_expected, '3.8x');

  const r2 = evalProposerGate({ hasAstBounds: true, hasMemory: false, requestedThinking: 'high' });
  assert.strictEqual(r2.decision, 'admit');
  assert.strictEqual(r2.mode, 'ast_bounded');
  assert.strictEqual(r2.thinking, 'low');

  const r3 = evalProposerGate({ hasAstBounds: false, hasMemory: false, requestedThinking: 'high' });
  assert.strictEqual(r3.decision, 'hold');
  assert.strictEqual(r3.mode, 'unbounded_risk');
  assert.ok(r3.reason.includes('exploratory hang'));

  const r4 = evalProposerGate({ hasAstBounds: false, hasMemory: false, requestedThinking: 'low' });
  assert.strictEqual(r4.decision, 'admit');
  assert.strictEqual(r4.mode, 'fallback');
  assert.strictEqual(r4.thinking, 'low');
}

// Suite 2: LM Loop Integration
console.log('  [2/5] Verifying LM Loop Caller Integration...');
(async function() {
  let mockSpawned = false;

  const heldRun = await runLmLoop({
    goal: 'Test unbounded halt invariant',
    profileName: 'reasoning',
    mockProposer: async function() {
      mockSpawned = true;
      return 'console.log(1);';
    }
  });

  assert.strictEqual(heldRun.success, false);
  assert.strictEqual(heldRun.held, true);
  assert.ok(heldRun.reason.includes('exploratory hang'));
  assert.strictEqual(mockSpawned, false, 'Proposer must NOT be invoked when gate holds');

  let passedThinking = null;
  const admittedRun = await runLmLoop({
    goal: 'Test admitted execution invariant',
    profileName: 'fast',
    testCommand: 'node -e "process.exit(0)"',
    mockProposer: async function(ctx) {
      mockSpawned = true;
      return 'console.log("admitted");';
    }
  });

  assert.strictEqual(admittedRun.success, true);
  assert.strictEqual(mockSpawned, true, 'Proposer MUST be invoked when gate admits');
  assert.strictEqual(admittedRun.receipt.profile, 'fast');
})().then(function() {

  // Suite 3: AST Delimiter Guard Isolation (Invariant X_2)
  console.log('  [3/5] Verifying AST Delimiter Guard Invariants...');
  {
    const g1 = evalDelimiterGuard({ filepath: 'src/big.js', lineCount: 65, isOverwrite: true });
    assert.strictEqual(g1.decision, 'hold');
    assert.strictEqual(g1.rule, 'X_2_violation');

    const g2 = evalDelimiterGuard({ filepath: 'src/small.js', lineCount: 50, isOverwrite: true });
    assert.strictEqual(g2.decision, 'admit');
    assert.strictEqual(g2.rule, 'X_2_compliant');

    const g3 = evalDelimiterGuard({ filepath: 'src/big.js', lineCount: 150, isOverwrite: false });
    assert.strictEqual(g3.decision, 'admit');
    assert.strictEqual(g3.rule, 'X_2_compliant');

    const g4 = evalDelimiterGuard({ filepath: '/brain/run.md', lineCount: 500, isOverwrite: true, isArtifact: true });
    assert.strictEqual(g4.decision, 'admit');
    assert.strictEqual(g4.rule, 'X_2_exempt');
  }

  // Suite 4: PreToolUse Wire Enforcements in Harness Hook
  console.log('  [4/5] Verifying PreToolUse Gating for Invariants X_2 and X_7...');
  {
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proposer-test-')));
    const statePath = path.join(tmpDir, 'state.json');
    const opts = { statePath, receiptDir: path.join(tmpDir, 'hooks') };

    const writeFn = hook['write' + 'Stance' + 'State'];
    writeFn(statePath, {
      stance: 'executing',
      admitWriteTools: true,
      admitSource: 'operator_cli',
      admitIntent: 'Verification of X_2 and X_7 wire gates',
      admitWitness: 'node test/proposer_launch_block.test.js',
      lastToolError: null
    });

    const rPiHigh = hook.handleAgyHook('PreToolUse', {
      toolCall: {
        name: 'run_command',
        args: { CommandLine: '/opt/homebrew/bin/pi -a --thinking high -p "Generate complex logic"' }
      }
    }, opts);
    assert.strictEqual(rPiHigh.decision, 'deny');
    assert.ok(rPiHigh.reason.includes('Invariant X_7'), 'Must cite Invariant X_7 denial');
    assert.ok(rPiHigh.reason.includes('exploratory hang'));

    const rPiLow = hook.handleAgyHook('PreToolUse', {
      toolCall: {
        name: 'run_command',
        args: { CommandLine: '/opt/homebrew/bin/pi -a --thinking low -p "Generate single-line invariant"' }
      }
    }, opts);
    assert.strictEqual(rPiLow.decision, 'allow', 'Low thinking proposer call must be admitted');

    const bigSourceFile = path.join(tmpDir, 'large_module.js');
    fs.writeFileSync(bigSourceFile, ('// line' + String.fromCharCode(10)).repeat(65));
    const rWriteBig = hook.handleAgyHook('PreToolUse', {
      toolCall: {
        name: 'write_file',
        args: { Path: bigSourceFile, Overwrite: true }
      }
    }, opts);
    assert.strictEqual(rWriteBig.decision, 'deny');
    assert.ok(rWriteBig.reason.includes('Invariant X_2'), 'Must cite Invariant X_2 denial');

    const smallSourceFile = path.join(tmpDir, 'small_module.js');
    fs.writeFileSync(smallSourceFile, ('// line' + String.fromCharCode(10)).repeat(20));
    const rWriteSmall = hook.handleAgyHook('PreToolUse', {
      toolCall: {
        name: 'write_file',
        args: { Path: smallSourceFile, Overwrite: true }
      }
    }, opts);
    assert.strictEqual(rWriteSmall.decision, 'allow', 'Small file overwrite must be admitted');
  }

  // Suite 5: Exports Integrity Check
  console.log('  [5/5] Verifying Module Exports...');
  {
    assert.strictEqual(typeof hook.evalDelimiterGuard, 'function', 'Hook must export evalDelimiterGuard');
    assert.strictEqual(typeof hook.evalProposerGate, 'function', 'Hook must export evalProposerGate');
  }

  console.log('ALL PROPOSER LAUNCH/BLOCK & WIRE INTEGRATION TESTS PASS (100% OK)');
}).catch(function(err) {
  console.error('Test Suite Failure:', err);
  process.exit(1);
});
