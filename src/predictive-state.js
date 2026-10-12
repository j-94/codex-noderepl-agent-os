'use strict';

// Read-only predictive-state observer. No modifications to the tape or reducer.
// This baseline groups histories by their empirically observed action/outcome signatures.
// Missing outcomes remain unknown: they are NEVER assumed equivalent to observed ones.
function observe(machine, observations) {
  if (!machine || !Array.isArray(machine.tape) || !Array.isArray(machine.receipts))
    throw new TypeError('machine with tape and receipts required');
  if (!Array.isArray(observations)) throw new TypeError('observations array required');
  const table = new Map();
  for (const item of observations) {
    if (!item || typeof item.state !== 'string' || typeof item.action !== 'string'
      || typeof item.outcome !== 'string') throw new TypeError('typed state/action/outcome required');
    if (!table.has(item.state)) table.set(item.state, new Map());
    const byAction = table.get(item.state);
    if (!byAction.has(item.action)) byAction.set(item.action, new Map());
    const counts = byAction.get(item.action);
    counts.set(item.outcome, (counts.get(item.outcome) || 0) + 1);
  }
  const actions = [...new Set(observations.map(o => o.action))].sort();
  const signatures = {};
  const groups = new Map();
  for (const [state, byAction] of table) {
    const signature = JSON.stringify(actions.map(a => {
      const counts = byAction.get(a);
      if (!counts) return null;
      const total = [...counts.values()].reduce((x,y) => x+y,0);
      return [...counts].sort(([a],[b]) => a.localeCompare(b))
        .map(([outcome,count]) => [outcome,count,total]);
    }));
    signatures[state] = signature;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(state);
  }
  return Object.freeze({
    tapeHead: machine.head,
    tapeLength: machine.tape.length,
    receiptCount: machine.receipts.length,
    stateCount: table.size,
    classCount: groups.size,
    classes: Object.freeze([...groups.values()].map(g => Object.freeze(g.sort()))),
    signatures: Object.freeze(signatures),
    limitation: 'Empirical action/outcome signatures only; not bisimulation or a learned transition model.'
  });
}
module.exports = { observe };
