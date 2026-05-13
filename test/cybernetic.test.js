'use strict';

const assert = require('assert');
const tape = require('../data/cybernetic-tape.v0.json');
const { bandRank, replayEvents, selectCandidate, tapeEvent } = require('../src/cybernetic');

assert.strictEqual(tape.root_law, 'S + delta + C -> S_prime');
assert(bandRank('u') < bandRank('f1'));
assert(bandRank('f2') < bandRank('f3'));
assert(bandRank('f3') < bandRank('inf'));

{
  const selected = selectCandidate([
    { id: 'prose_fix', evidence: 0.4, rollback: false, receipt: false, relevance: 0.8, cost: 0.1, band: 'f1', novelty: 0.8 },
    { id: 'receipt_backed_reflex', evidence: 1, rollback: true, receipt: true, relevance: 0.9, cost: 0.2, band: 'f2', novelty: 0.2 }
  ], { temperature: 0.1 });
  assert.strictEqual(selected.id, 'receipt_backed_reflex');
}

{
  const event = tapeEvent({
    id: 'event:test',
    state: 'failure observed',
    delta: 'candidate correction',
    control: { promotion_band: 'f2', rollback: 'discard candidate', evidence: ['test'] },
    nextState: 'correction replayable',
    receipt: 'receipt.json'
  });
  assert.strictEqual(event.kind, 'bvt.cybernetic_tape.event.v0');
  assert.strictEqual(event.C.promotion_band, 'f2');
}

{
  const replayable = replayEvents(tape.events, 'f2');
  assert.strictEqual(replayable.length, 2);
  assert(replayable.every((event) => event.C.promotion_band === 'f2'));
}

console.log('cybernetic tape test: ok');
