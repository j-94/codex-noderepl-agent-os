'use strict';
// Open-ended procedural stream experiment. No fixed episode dataset, no writes
// outside the native virtual tape, no claims of general open-ended intelligence.
const {init,step} = require('../../src/core');
const {memfs} = require('../../src/tools');
const {observe} = require('../../src/predictive-state');

function* world(seed=13) {
  let s=seed>>>0, t=0;
  while(true) {
    s=(Math.imul(s,1664525)+1013904223)>>>0;
    const context='context-'+(s%17);
    const action=['inspect','repair','verify'][t%3];
    const regime=Math.floor(t/45)%3;
    const outcome=((s>>>8)%5===regime)?'success':'failure';
    yield {context,action,outcome,regime,step:t++};
  }
}
function run({seed=13,steps=180,window=90}={}) {
  if(!Number.isInteger(steps)||steps<1||steps>10000) throw new RangeError('steps must be 1..10000');
  let machine=init(), history=[], snapshots=[];
  const stream=world(seed);
  for(let i=0;i<steps;i++) {
    const event=stream.next().value;
    // The existing core remains the sole writer of tape and receipts.
    machine=step(machine,memfs.write('stream/'+i,event));
    history.push({state:event.context,action:event.action,outcome:event.outcome});
    if((i+1)%15===0||i===steps-1) {
      const model=observe(machine,history.slice(-window));
      snapshots.push({step:i+1,head:machine.head,receipts:machine.receipts.length,
        observedStates:model.stateCount,classes:model.classCount});
    }
  }
  return {seed,steps,window,head:machine.head,receiptCount:machine.receipts.length,snapshots,
    limitation:'Procedural nonstationary stream; outcome grouping is not a learned transition model.'};
}
if(require.main===module) console.log(JSON.stringify(run(),null,2));
module.exports={world,run};
