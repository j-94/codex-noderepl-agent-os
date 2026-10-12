'use strict';
// Online action-conditioned empirical predictor and policy.
// This is a contextual bandit with a sliding evidence window, NOT CSSR/PSR.
// The policy sees context, never the hidden regime or unobserved rewards.
const {init,step} = require('../../src/core');
const {memfs} = require('../../src/tools');
const ACTIONS=['inspect','repair','verify'];
function random(seed) {
  let x=seed>>>0;
  return () => ((x=(Math.imul(1664525,x)+1013904223)>>>0)/4294967296);
}
function environment(context, action, time, noise) {
  const regime=Math.floor(time/150)%3;
  const target=(context+regime)%3;
  return Number(action===target && noise>=0.05);
}
function makePolicy({window=90,explore=0.15,adaptive=true}={}) {
  const data=[];
  function probability(context,action) {
    const subset=data.filter(r=>r.context===context&&r.action===action);
    const wins=subset.reduce((sum,r)=>sum+r.reward,0);
    return (wins+1)/(subset.length+2);
  }
  return {
    choose(context,rand) {
      if(rand()<explore) return Math.floor(rand()*3);
      const estimates=ACTIONS.map((_,a)=>probability(context,a));
      return estimates.indexOf(Math.max(...estimates));
    },
    predict:probability,
    observe(record) {
      if(!adaptive && data.length>=window) return;
      data.push(record);
      if(adaptive && data.length>window) data.shift();
    },
    size:()=>data.length
  };
}
function run({seed=17,steps=900,window=90,explore=0.15}={}) {
  if(!Number.isInteger(steps)||steps<300||steps>10000) throw new RangeError('steps must be 300..10000');
  const rng=random(seed), policies={
    adaptive:makePolicy({window,explore,adaptive:true}),
    frozen:makePolicy({window,explore,adaptive:false}),
    random:null
  };
  const machines={adaptive:init(),frozen:init(),random:init()};
  const stats=Object.fromEntries(Object.keys(policies).map(k=>[k,{reward:0,byRegime:[0,0,0],count:[0,0,0],brier:0}]));
  const log=[];
  for(let t=0;t<steps;t++) {
    const context=Math.floor(rng()*6);
    const noise=rng(); // shared environment noise: paired comparisons
    const regime=Math.floor(t/150)%3;
    for(const [name,policy] of Object.entries(policies)) {
      const action=policy?policy.choose(context,rng):Math.floor(rng()*3);
      const predicted=policy?policy.predict(context,action):1/3;
      const reward=environment(context,action,t,noise);
      const event={context,action:ACTIONS[action],reward,step:t};
      machines[name]=step(machines[name],memfs.write('observation/'+t,event));
      if(policy) policy.observe({context,action,reward});
      const s=stats[name];
      s.reward+=reward;s.byRegime[regime]+=reward;s.count[regime]++;
      s.brier+=(predicted-reward)**2;
      if(name==='adaptive' && (t+1)%150===0)
        log.push({step:t+1,regime,successRate:s.byRegime[regime]/s.count[regime],
          tapeHead:machines[name].head,receipts:machines[name].receipts.length,
          evidenceWindow:policy.size()});
    }
  }
  return {seed,steps,window,explore,
    results:Object.fromEntries(Object.entries(stats).map(([k,s])=>[k,{
      successRate:s.reward/steps,regimeRates:s.byRegime.map((v,i)=>s.count[i]?v/s.count[i]:null),
      brier:s.brier/steps,head:machines[k].head,receipts:machines[k].receipts.length
    }])),snapshots:log,
    caveat:'Contextual bandit with known action set, synthetic outcomes, and sliding-window frequencies; not epsilon-transducer, PSR, or open-ended representation discovery.'};
}
if(require.main===module) console.log(JSON.stringify(run(),null,2));
module.exports={run,makePolicy,environment,random};
