'use strict';
const assert = require('node:assert/strict');
const { bootstrap, demo } = require('../experiments/predictive-state/bootstrap');
const { readMem } = require('../src/core');
const a = bootstrap(demo);
const b = bootstrap(demo);
assert.equal(a.machine.head, 3);
assert.equal(a.machine.receipts.length, 3);
assert.equal(a.machine.tape.length, 4); // boot plus 3 events
assert.equal(a.model.stateCount, 3);
assert.equal(a.model.classCount, 2);
assert.deepEqual(a.model.classes, b.model.classes);
assert.deepEqual(a.machine.receipts, b.machine.receipts);
assert.deepEqual(readMem(a.machine, 'observation/0').value, demo[0]);
assert.throws(() => bootstrap([{state:'x',action:'a'}]), TypeError);
console.log('predictive-state bootstrap: ok');
