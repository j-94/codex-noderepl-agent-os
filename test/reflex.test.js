'use strict';

const assert = require('assert');
const memory = require('../data/reflex-memory.v0.json');
const { matchReflex, packetFromMatch } = require('../src/reflex');

{
  const match = matchReflex('proceed, do it, build it', memory);
  const packet = packetFromMatch(match);
  assert.strictEqual(packet.status, 'matched');
  assert.strictEqual(packet.reflex_id, 'proceed_effect');
  assert(packet.operators.includes('UTIR_materialization'));
  assert(packet.operators.includes('rollback_drill'));
  assert(packet.blocks.includes('apply_patch_first'));
}

{
  const match = matchReflex('can we measure accuracy and prove this is real?', memory);
  const packet = packetFromMatch(match);
  assert.strictEqual(packet.reflex_id, 'claim_accuracy');
  assert(packet.blocks.includes('overclaim_without_receipt'));
}

{
  const match = matchReflex('look at our prior work in history', memory);
  const packet = packetFromMatch(match);
  assert.strictEqual(packet.reflex_id, 'prior_work');
  assert(packet.operators.includes('compress_before_expand'));
}

{
  const match = matchReflex('why are you writing files? stop writing files and use utir', memory);
  const packet = packetFromMatch(match);
  assert.strictEqual(packet.reflex_id, 'file_write_correction');
  assert(packet.operators.includes('hold_effects'));
  assert(packet.blocks.includes('source_doc_sprawl'));
}

{
  const match = matchReflex('run an agent and complete the task with an end insight', memory);
  const packet = packetFromMatch(match);
  assert.strictEqual(packet.reflex_id, 'agent_completion_contract');
  assert(packet.operators.includes('end_insight_reducer'));
  assert(packet.blocks.includes('user_managed_context_loop'));
}

{
  const packet = packetFromMatch(matchReflex('hello unrelated', memory));
  assert.strictEqual(packet.status, 'hold');
}

console.log('turn0 reflex test: ok');
