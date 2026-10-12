'use strict';
const assert=require('node:assert/strict');
const {demo,evaluate,seededShuffle}=require('../experiments/predictive-state/evaluate');
const rows=demo();
const a=evaluate(rows), b=evaluate(rows);
assert.deepEqual(a,b);
assert.equal(a.trainCount,160);
assert.equal(a.testCount,40);
assert.equal(a.tapeHead,160);
assert.equal(a.receiptCount,160);
assert.ok(a.classes>=1);
for (const model of [a.baseline,a.stateAction]) {
  assert.ok(model.accuracy>=0&&model.accuracy<=1);
  assert.ok(Number.isFinite(model.logLoss)&&model.logLoss>=0);
  assert.ok(Number.isFinite(model.brier)&&model.brier>=0);
}
const shuffled=evaluate(seededShuffle(rows));
assert.notEqual(shuffled.datasetHash,a.datasetHash);
assert.notEqual(shuffled.trainHash,a.trainHash);
assert.throws(()=>evaluate(rows.slice(0,10)),/at least 20/);
console.log('predictive-state evaluation: ok');
