'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  grandHypothesisProof,
  heldoutEvidence,
  normalizeHeldoutPayload,
  proofStatus,
  tensorEvidence,
} = require('../src/proof');
const { verify } = require('../scripts/heldout_pair');

const tensorBakeoff = {
  verdict: 'scoped_learned_tensor_memory_cleared',
  scores: {
    bm25_keyword: { correct: 4, total: 12 },
    tensor_field_ablated: { correct: 0, total: 12 },
    learned_transition_tensor_memory: { correct: 12, total: 12 },
  },
  claim_boundary: { allowed: 'learned runtime transition-tensor memory on local heldout' },
};

const bvtStudy = {
  admission_decision: 'canary',
  improvements: {
    missing_probe_rate_delta: -0.5,
    rollback_gap_rate_delta: -0.32,
    overclaim_rate_delta: -0.2,
    out_of_scope_edit_rate_delta: -0.14,
    failed_probe_rate_delta: -0.5,
    useful_completion_rate_delta: 0.04,
  },
  claim_boundary: {
    allowed: 'BVT ran a simulated Codex session improvement study with held-out wrapper comparison.',
  },
};

{
  const lane = tensorEvidence(tensorBakeoff);
  assert.strictEqual(lane.status, 'pass');
  assert.deepStrictEqual(lane.learned, { correct: 12, total: 12 });
}

{
  const lane = heldoutEvidence({ completed_pairs: 0 });
  assert.strictEqual(lane.status, 'blocked_missing_live_pairs');
  assert.strictEqual(lane.required_pairs, 20);
}

// A zeroed wrong-file rate in both arms is a measured result with nothing to compare, not a
// regression and not a missing measurement. Each of the three states must stay distinguishable.
{
  const base = {
    completed_pairs: 20,
    promotion_decision: 'do_not_promote_protocol_or_shadow_only',
    metrics: {
      direct_success_rate: 1,
      controlled_success_rate: 1,
      mean_direct_ms: 9,
      mean_controlled_ms: 8,
      // The legacy single-arm shape reads its own names; the paired shape recomputes these.
      baseline_success_rate: 1,
      candidate_success_rate: 1,
      candidate_claim_calibration: 1,
      baseline_time_to_admissible_patch: 9,
      candidate_time_to_admissible_patch: 8,
    },
  };
  const zeroed = heldoutEvidence({
    ...base,
    pairs: Array.from({ length: 20 }, () => ({ direct_success: true, controlled_success: true, direct_ms: 9, controlled_ms: 8 })),
    metrics: { ...base.metrics, direct_wrong_file_rate: 0, controlled_wrong_file_rate: 0 },
  });
  assert.deepStrictEqual(zeroed.unmeasured_gates, [
    'heldout wrong-file rate cannot discriminate: neither arm recorded a wrong-file edit',
  ]);

  const missing = heldoutEvidence({ ...base, metrics: { ...base.metrics, direct_wrong_file_rate: null } });
  assert.deepStrictEqual(missing.unmeasured_gates, ['heldout candidate wrong-file rate is unmeasured']);

  // Both rates measured, candidate not strictly lower: a real regression, not an evidence gap.
  const regressed = heldoutEvidence({
    ...base,
    metrics: { ...base.metrics, baseline_wrong_file_rate: 0.05, candidate_wrong_file_rate: 0.05 },
  });
  assert.deepStrictEqual(regressed.unmeasured_gates, []);
  assert.deepStrictEqual(regressed.gate_failures, [
    'heldout candidate wrong-file rate must be lower than baseline',
  ]);
}

{
  const scorer = {
    completed_pairs: 1,
    promotion_decision: 'do_not_promote_protocol_or_shadow_only',
  };
  const receipt = {
    payload: {
      effects: [
        {
          result: {
            output: { scorer },
          },
        },
      ],
    },
  };
  assert.deepStrictEqual(normalizeHeldoutPayload(receipt), scorer);
  assert.strictEqual(heldoutEvidence(receipt).completed_pairs, 1);
}

{
  const proof = grandHypothesisProof({
    tensor_bakeoff: tensorBakeoff,
    bvt_study: bvtStudy,
    heldout_report: { completed_pairs: 0 },
    latency: { beforeSnapshotMs: 76870.089, counts: [100, 5000] },
  });
  assert.strictEqual(proof.kind, 'agent_os.grand_hypothesis_proof.v0');
  assert.strictEqual(proof.decision, 'canary_progress_hold_promotion');
  assert.strictEqual(proof.lanes.latency.status, 'pass');
  assert.strictEqual(proof.lanes.tensor.status, 'pass');
  assert.strictEqual(proof.lanes.bvt.status, 'canary_pass');
  assert.strictEqual(proof.lanes.heldout.status, 'blocked_missing_live_pairs');
  assert.ok(proof.lanes.latency.speedup > 1000);
  assert.ok(proof.claim_boundary.includes('not production reliability'));
}

{
  const proof = grandHypothesisProof({
    tensor_bakeoff: tensorBakeoff,
    bvt_study: bvtStudy,
    heldout_report: { completed_pairs: 20, promotion_decision: 'promote_canary' },
    latency: { beforeSnapshotMs: 76870.089, counts: [100, 5000] },
  });
  assert.strictEqual(proof.decision, 'promote_candidate');
  assert.deepStrictEqual(proof.missing_for_promotion, []);
}

{
  const proof = grandHypothesisProof({
    tensor_bakeoff: tensorBakeoff,
    bvt_study: bvtStudy,
    heldout_report: {
      completed_pairs: 20,
      promotion_decision: 'do_not_promote_protocol_or_shadow_only',
      metrics: {
        baseline_success_rate: 0.95,
        candidate_success_rate: 0.95,
        baseline_wrong_file_rate: 0.05,
        candidate_wrong_file_rate: 0.05,
        baseline_time_to_admissible_patch: 0,
        candidate_time_to_admissible_patch: 0,
        candidate_claim_calibration: 1,
      },
    },
    latency: { beforeSnapshotMs: 76870.089, counts: [100, 5000] },
  });
  assert.strictEqual(proof.decision, 'canary_progress_hold_promotion');
  assert.strictEqual(proof.lanes.heldout.status, 'completed_pairs_hold');
  assert.deepStrictEqual(proof.missing_for_promotion, [
    'heldout candidate wrong-file rate must be lower than baseline',
  ]);
}

{
  const status = proofStatus({
    tensor_bakeoff: tensorBakeoff,
    bvt_study: bvtStudy,
    heldout_report: { completed_pairs: 20, promotion_decision: 'promote_canary' },
    latency: { beforeSnapshotMs: 76870.089, counts: [100, 5000] },
  });
  assert.deepStrictEqual(status, {
    decision: 'promote_candidate',
    missing_for_promotion: [],
  });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-heldout-'));
  const reportPath = path.join(dir, 'report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      payload: {
        report: {
          completed_pairs: 20,
          promotion_decision: 'promote_canary',
          claim_boundary: 'tmp heldout report for proof-path regression',
        },
      },
    }),
  );
  const proof = grandHypothesisProof({
    tensor_bakeoff: tensorBakeoff,
    bvt_study: bvtStudy,
    heldout_report_path: reportPath,
    latency: { beforeSnapshotMs: 76870.089, counts: [100, 5000] },
  });
  assert.strictEqual(proof.decision, 'promote_candidate');
  assert.strictEqual(proof.receipts.heldout_report, reportPath);
}

{
  const stdout = execFileSync(process.execPath, ['agent-os', 'proof-status'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  const status = JSON.parse(stdout);
  assert.ok(Object.prototype.hasOwnProperty.call(status, 'decision'));
  assert.ok(Object.prototype.hasOwnProperty.call(status, 'missing_for_promotion'));
  assert.strictEqual(Object.keys(status).length, 2);
}

// The heldout runner is the only source of the evidence the gate reads, so its
// two measurements are tested directly: an out-of-scope write must be visible,
// and a command that exits 0 with the wrong output must not count as a pass.
{
  const { execFileSync: run } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-wrongfile-'));
  fs.writeFileSync(path.join(dir, 'agent-os'), 'baseline\n');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test/proof.test.js'), 'process.exit(0)\n');
  const git = (...a) => run('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'base');
  // The arm writes one in-scope file and one outside the declared scope.
  fs.writeFileSync(path.join(dir, 'agent-os'), 'baseline\nadded\n');
  fs.mkdirSync(path.join(dir, 'stray'));
  fs.writeFileSync(path.join(dir, 'stray/note.txt'), 'outside scope\n');
  const changed = git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  assert.ok(changed.includes('agent-os'), 'in-scope edit must be visible as a change');
  assert.ok(changed.includes('stray/'), 'out-of-scope write must be visible as a change');
  fs.rmSync(dir, { recursive: true, force: true });

  // Output correctness: exit 0 alone is not a pass.
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-verify-'));
  fs.mkdirSync(path.join(cliDir, 'test'));
  fs.writeFileSync(path.join(cliDir, 'test/proof.test.js'), 'process.exit(0)\n');
  fs.writeFileSync(
    path.join(cliDir, 'agent-os'),
    '#!/usr/bin/env node\nconst a=process.argv[2];console.log(a==="right"?"expected":"wrong");\n',
  );
  fs.chmodSync(path.join(cliDir, 'agent-os'), 0o755);
  assert.strictEqual(verify(cliDir, { cmd: 'right', expect: 'expected' }).cmd_ok, true);
  assert.strictEqual(verify(cliDir, { cmd: 'other', expect: 'expected' }).cmd_ok, false);
  fs.rmSync(cliDir, { recursive: true, force: true });
}

console.log('grand hypothesis proof test: ok');
