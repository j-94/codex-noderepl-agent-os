'use strict';

const assert = require('node:assert');
const { evalDelimiterGuard } = require('../src/ast_delimiter_guard');

// 1. Artifact path exemption
const r1 = evalDelimiterGuard({ filepath: '/brain/run.md', lineCount: 500, isOverwrite: true, isArtifact: true });
assert.strictEqual(r1.decision, 'admit');
assert.strictEqual(r1.rule, 'X_2_exempt');

// 2. Small file overwrite permitted
const r2 = evalDelimiterGuard({ filepath: 'src/mini.js', lineCount: 20, isOverwrite: true, isArtifact: false });
assert.strictEqual(r2.decision, 'admit');
assert.strictEqual(r2.rule, 'X_2_compliant');

// 3. Catastrophic whole-file overwrite held
const r3 = evalDelimiterGuard({ filepath: 'src/large.js', lineCount: 150, isOverwrite: true, isArtifact: false });
assert.strictEqual(r3.decision, 'hold');
assert.strictEqual(r3.rule, 'X_2_violation');
assert.ok(r3.reason.includes('exceeds threshold 60'));

// 4. Surgical edit permitted
const r4 = evalDelimiterGuard({ filepath: 'src/large.js', lineCount: 150, isOverwrite: false, isArtifact: false });
assert.strictEqual(r4.decision, 'admit');
assert.strictEqual(r4.rule, 'X_2_compliant');

console.log('ast_delimiter_guard: ALL TESTS PASS');
