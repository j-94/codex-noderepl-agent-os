'use strict';
const assert = require('node:assert/strict');
const { init, run, snapshot, stable } = require('../src/core');
const { memfs } = require('../src/tools');
const { observe } = require('../src/predictive-state');

const machine = run(init(), [memfs.write('a', 'one'), memfs.read('a')]);
const before = stable(snapshot(machine));
const receipts = machine.receipts.length;
const observations = [
  {state:'s1',action:'inspect',outcome:'ok'},
  {state:'s2',action:'inspect',outcome:'ok'},
  {state:'s3',action:'inspect',outcome:'fail'}
];
const result = observe(machine, observations);
assert.equal(result.stateCount, 3);
assert.equal(result.classCount, 2);
assert.ok(result.classes.some(c => c.join(',') === 's1,s2'));
assert.equal(result.tapeHead, 2);
assert.equal(result.receiptCount, receipts);
assert.equal(stable(snapshot(machine)), before, 'observer must not mutate machine');
const missing = observe(machine, [
  {state:'s1',action:'inspect',outcome:'ok'},
  {state:'s2',action:'repair',outcome:'ok'}
]);
assert.equal(missing.classCount, 2, 'missing action outcomes cannot be merged');
const changed = observe(machine, [
  {state:'s1',action:'inspect',outcome:'ok'},
  {state:'s2',action:'inspect',outcome:'fail'}
]);
assert.equal(changed.classCount, 2, 'changed outcomes must split states');
assert.throws(() => observe(machine, [{state:'x',action:'inspect'}]), TypeError);
console.log('predictive-state observer: ok (read-only, observed-signature baseline)');
