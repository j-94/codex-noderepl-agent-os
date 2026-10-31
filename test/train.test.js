'use strict';

const assert = require('assert');
const {
  PRIORS_KEY,
  TRAINING_KEY,
  learnEvent,
  parseRows,
  precomputePriors,
  rewardFor,
  rowsFromJson,
  trainTape,
} = require('../src/train');

{
  assert.strictEqual(rewardFor('test_passed'), 1);
  assert.strictEqual(rewardFor('user_corrected'), -1);
  assert.strictEqual(rewardFor('not_real'), 0);
}

{
  const event = learnEvent({
    id: 'row:1',
    intent: 'stop direct writes',
    outcome: 'user_corrected',
  });
  assert.strictEqual(event.kind, 'agent_os.training_event.v0');
  assert.strictEqual(event.reward, -1);
  assert.strictEqual(event.gate, 'hold');
  assert.strictEqual(event.packet_hash.length, 64);
}

{
  const rows = parseRows('{"intent":"a","outcome":"test_passed"}\n{"intent":"b","outcome":"held"}\n');
  assert.strictEqual(rows.length, 2);
}

{
  const rows = rowsFromJson({ records: [{ objective: 'a' }, { objective: 'b' }] });
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(parseRows('{"records":[{"objective":"a"}]}'), [{ objective: 'a' }]);
}

{
  const events = [
    learnEvent({ intent: 'recover history', outcome: 'test_passed' }),
    learnEvent({ intent: 'write without gate', outcome: 'user_corrected' }),
  ];
  const priors = precomputePriors(events);
  assert.strictEqual(priors.rows, 2);
  assert.strictEqual(priors.reward_sum, 0);
  assert.strictEqual(priors.gate.hold.n, 1);
}

{
  const run = trainTape([
    { intent: 'recover codex history first', outcome: 'test_passed' },
    { intent: 'direct file write drift', outcome: 'user_corrected' },
  ]);
  assert.strictEqual(run.kind, 'agent_os.training_run.v0');
  assert.strictEqual(run.machine.mem[0][0], TRAINING_KEY);
  assert.strictEqual(run.machine.mem[1][0], PRIORS_KEY);
  assert.strictEqual(run.receipts, 2);
  assert.strictEqual(run.priors.rows, 2);
  assert.strictEqual(run.events_hash.length, 64);
  assert.strictEqual(run.priors_hash.length, 64);
}

console.log('training tape test: ok');
