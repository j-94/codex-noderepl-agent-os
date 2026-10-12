'use strict';
// Dependency-free bootstrap of the existing codex-tape and read-only observer.
// Run: node experiments/predictive-state/bootstrap.js
const { init, step } = require('../../src/core');
const { memfs } = require('../../src/tools');
const { observe } = require('../../src/predictive-state');
function bootstrap(records) {
  let machine = init();
  const observations = [];
  for (const record of records) {
    if (!record || !['state','action','outcome'].every(k => typeof record[k] === 'string'))
      throw new TypeError('Each record needs string state, action, outcome');
    // Every imported observation is recorded on the original machine tape as
    // a virtual write. The observer consumes explicit outcomes, not hash-only receipts.
    machine = step(machine, memfs.write('observation/' + observations.length, record));
    observations.push(record);
  }
  return {machine, model: observe(machine, observations)};
}
const demo = [
  {state:'repo-a:missing-dep',action:'inspect',outcome:'missing'},
  {state:'repo-b:missing-dep',action:'inspect',outcome:'missing'},
  {state:'repo-c:syntax',action:'inspect',outcome:'syntax'}
];
if (require.main === module) {
  const fs = require('node:fs');
  const input = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : demo;
  const {machine, model} = bootstrap(input);
  console.log(JSON.stringify({head:machine.head, receipts:machine.receipts.length,
    states:model.stateCount, classes:model.classCount, groups:model.classes}, null, 2));
}
module.exports = {bootstrap, demo};
