'use strict';

const assert = require('assert');
const {
  backlogReport,
  platformPacket,
  rolloutBenchmark,
  siteLoadingReceipt,
} = require('../src/backlog');

{
  const run = rolloutBenchmark({ count: 100 });
  assert.strictEqual(run.kind, 'rollout_benchmark.v0');
  assert.strictEqual(run.candidates_requested, 100);
  assert.strictEqual(run.virtual_candidates_stored, 100);
  assert.strictEqual(run.disk_writes, 0);
  assert.strictEqual(run.gate_halted_on_unadmitted_effect, true);
  assert.strictEqual(run.receipts, 101);
  assert.strictEqual(run.receipt_tail.length, 64);
}

{
  const receipt = siteLoadingReceipt({ '/': 200, '/blog.html': 200, '/missing': 404 });
  assert.strictEqual(receipt.kind, 'site_loading_receipt.v0');
  assert.strictEqual(receipt.ok, false);
  assert.strictEqual(receipt.entries.length, 3);
}

{
  const packet = platformPacket();
  assert.strictEqual(packet.kind, 'platform_packet.v0');
  assert.strictEqual(packet.public_site.target, 'Vercel');
  assert.strictEqual(packet.talk_to_system.target, 'Hugging Face Spaces');
  assert.strictEqual(packet.gate.decision, 'hold');
}

{
  const report = backlogReport({ statuses: { '/': 200 } });
  assert.strictEqual(report.kind, 'backlog_materialization_report.v0');
  assert.strictEqual(report.rollout.virtual_candidates_stored, 100);
  assert.strictEqual(report.site.ok, true);
}

console.log('backlog materialization test: ok');
