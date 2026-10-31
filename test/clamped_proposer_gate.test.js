'use strict';

const assert = require('node:assert');
const { evalProposerGate } = require('../src/proposer_gate');

// 1. Compound quad-stack admits with clamped low-thinking
const r1 = evalProposerGate({ hasAstBounds: true, hasMemory: true, requestedThinking: 'high' });
assert.strictEqual(r1.decision, 'admit');
assert.strictEqual(r1.mode, 'compound_quad');
assert.strictEqual(r1.thinking, 'low');
assert.strictEqual(r1.speedup_expected, '3.8x');

// 2. AST bounded alone admits with low-thinking
const r2 = evalProposerGate({ hasAstBounds: true, hasMemory: false, requestedThinking: 'high' });
assert.strictEqual(r2.decision, 'admit');
assert.strictEqual(r2.mode, 'ast_bounded');
assert.strictEqual(r2.thinking, 'low');

// 3. Unbounded high-thinking held due to exploratory timeout risk
const r3 = evalProposerGate({ hasAstBounds: false, hasMemory: false, requestedThinking: 'high' });
assert.strictEqual(r3.decision, 'hold');
assert.strictEqual(r3.mode, 'unbounded_risk');
assert.ok(r3.reason.includes('exploratory hang'));

// 4. Low-thinking fallback admitted
const r4 = evalProposerGate({ hasAstBounds: false, hasMemory: false, requestedThinking: 'low' });
assert.strictEqual(r4.decision, 'admit');
assert.strictEqual(r4.mode, 'fallback');
assert.strictEqual(r4.thinking, 'low');

console.log('clamped_proposer_gate: ALL TESTS PASS');
