'use strict';
// Deterministic held-out evaluation for a deliberately simple empirical predictor.
// Train is chronologically before test; labels are never accessed during prediction.
// This is an evaluation scaffold, NOT a learned predictive-state model.
const crypto = require('node:crypto');
const { init, step, stable } = require('../../src/core');
const { memfs } = require('../../src/tools');
const { observe } = require('../../src/predictive-state');

function hash(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function seededShuffle(records, seed=17) {
  const a=records.slice(); let s=seed>>>0;
  for (let i=a.length-1;i>0;i--) {
    s=(Math.imul(1664525,s)+1013904223)>>>0;
    const j=s%(i+1); [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function demo(n=200) {
  // Sequential environment: outcomes depend on previous event, not just action.
  let prev=0; const rows=[];
  for (let i=0;i<n;i++) {
    const action=i%3===0?'inspect':'repair';
    const state='s'+(i%5);
    const outcome=prev?'ok':'fail';
    rows.push({state,action,outcome});
    prev=(prev+(i%7===0?1:0))%2;
  }
  return rows;
}
function evaluate(records, opts={}) {
  if (!Array.isArray(records) || records.length<20) throw new Error('Need at least 20 records');
  const cut=Math.floor(records.length*0.8);
  const train=records.slice(0,cut), test=records.slice(cut);
  const counts=new Map(), global=new Map();
  for (const row of train) {
    const key=row.state+'\u0000'+row.action;
    if (!counts.has(key)) counts.set(key,new Map());
    const c=counts.get(key); c.set(row.outcome,(c.get(row.outcome)||0)+1);
    global.set(row.outcome,(global.get(row.outcome)||0)+1);
  }
  const labels=[...new Set(records.map(x=>x.outcome))].sort();
  function predict(row, model) {
    const c=model==='state-action' ? counts.get(row.state+'\u0000'+row.action) : null;
    const source=c||global, total=[...source.values()].reduce((a,b)=>a+b,0);
    const k=labels.length;
    return Object.fromEntries(labels.map(label=>[label,((source.get(label)||0)+1)/(total+k)]));
  }
  function score(model) {
    let hits=0, loss=0, brier=0;
    for (const row of test) {
      const p=predict(row,model);
      const guess=labels.slice().sort((a,b)=>p[b]-p[a]||a.localeCompare(b))[0];
      hits+=Number(guess===row.outcome);
      loss-=Math.log(p[row.outcome]);
      for (const label of labels) brier+=(p[label]-Number(label===row.outcome))**2;
    }
    return {accuracy:hits/test.length,logLoss:loss/test.length,brier:brier/test.length};
  }
  let machine=init();
  for (const row of train) machine=step(machine,memfs.write('observation/'+machine.head,row));
  const observer=observe(machine,train);
  return {
    schema:1, trainCount:train.length,testCount:test.length,
    datasetHash:hash(records), trainHash:hash(train), testHash:hash(test),
    tapeHead:machine.head, receiptCount:machine.receipts.length,
    classes:observer.classCount,
    baseline:score('global'), stateAction:score('state-action'),
    note:'Observed-frequency baseline; no temporal predictive model or causal guarantees.'
  };
}
function run() {
  const records=demo();
  const original=evaluate(records), repeated=evaluate(records);
  if (JSON.stringify(original)!==JSON.stringify(repeated)) throw Error('Replay mismatch');
  const shuffled=evaluate(seededShuffle(records));
  const receipt={original,shuffled,deterministicReplay:true,
    interpretation:'Shuffling is a diagnostic control, not proof of temporal learning.'};
  console.log(JSON.stringify(receipt,null,2));
}
if (require.main===module) run();
module.exports={demo,evaluate,seededShuffle};
