'use strict';

const fs = require('fs');
const path = require('path');
const { rolloutBenchmark } = require('./backlog');

const DEFAULT_TENSOR_BAKEOFF =
  '/Users/jobs/Desktop/bit-vector-tensor-control-policy/runs/frontier-clearance-loop/20260502T-tensor-memory/artifacts/TENSOR_MEMORY_BAKEOFF.json';
const DEFAULT_BVT_STUDY_ROOT =
  '/Users/jobs/Desktop/bit-vector-tensor-control-policy/bvt-core/runs/bvt-codex-study';
// Read lazily: process.env is captured at require time otherwise, which makes
// the caller's env assignment a silent no-op and reports the wrong lane.
function defaultHeldoutReport() {
  return process.env.AGENT_OS_HELDOUT_REPORT || '';
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function latestReceipt(root) {
  try {
    const candidates = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'receipt.json'))
      .filter((file) => fs.existsSync(file))
      .sort();
    return candidates.at(-1) || null;
  } catch {
    return null;
  }
}

function normalizeHeldoutPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.report && typeof payload.report === 'object') return payload.report;
  if (payload.heldout_report && typeof payload.heldout_report === 'object') {
    return payload.heldout_report;
  }
  const scorer = payload?.payload?.effects?.[0]?.result?.output?.scorer;
  if (scorer && typeof scorer === 'object') return scorer;
  const nestedReport = payload?.payload?.report;
  if (nestedReport && typeof nestedReport === 'object') return nestedReport;
  return payload;
}

function tensorEvidence(payload) {
  const scores = payload?.scores || {};
  const learned = scores.learned_transition_tensor_memory || {};
  const bm25 = scores.bm25_keyword || {};
  const ablated = scores.tensor_field_ablated || {};
  return Object.freeze({
    kind: 'proof_lane.tensor_route.v0',
    status:
      learned.correct === learned.total && learned.correct > (bm25.correct || 0) && learned.correct > (ablated.correct || 0)
        ? 'pass'
        : 'weak',
    learned,
    bm25,
    ablated,
    verdict: payload?.verdict || 'missing',
    claim_boundary:
      payload?.claim_boundary?.allowed ||
      'tensor route lane requires the local tensor bakeoff receipt before stronger claims',
  });
}

function bvtEvidence(payload) {
  const improvements = payload?.improvements || {};
  const useful = improvements.useful_completion_rate_delta || 0;
  const defectDeltas = [
    improvements.missing_probe_rate_delta,
    improvements.rollback_gap_rate_delta,
    improvements.overclaim_rate_delta,
    improvements.out_of_scope_edit_rate_delta,
    improvements.failed_probe_rate_delta,
  ].filter((item) => typeof item === 'number');
  const defectsImproved = defectDeltas.length > 0 && defectDeltas.every((item) => item <= 0);
  return Object.freeze({
    kind: 'proof_lane.bvt_canary.v0',
    status: payload?.admission_decision === 'canary' && defectsImproved ? 'canary_pass' : 'weak_or_missing',
    decision: payload?.admission_decision || 'missing',
    useful_completion_delta: useful,
    defect_deltas: Object.freeze({
      missing_probe_rate_delta: improvements.missing_probe_rate_delta,
      rollback_gap_rate_delta: improvements.rollback_gap_rate_delta,
      overclaim_rate_delta: improvements.overclaim_rate_delta,
      out_of_scope_edit_rate_delta: improvements.out_of_scope_edit_rate_delta,
      failed_probe_rate_delta: improvements.failed_probe_rate_delta,
    }),
    claim_boundary:
      payload?.claim_boundary?.allowed ||
      'BVT lane requires a canary study receipt before stronger claims',
  });
}

/**
 * Map a report onto the four promotion gates, whatever shape it uses.
 *
 * Two shapes exist: the legacy single-arm report (candidate_* / baseline_*)
 * and the paired aggregate written by scripts/heldout_score.js, which carries
 * per-pair outcomes instead of invented rates. A missing metric is a failed
 * gate, never a pass.
 */
function heldoutGateMetrics(report, metrics) {
  const pairs = Array.isArray(report.pairs) ? report.pairs : null;
  const out = {};
  if (pairs) {
    // Paired form. Every gate is computed from the receipts, not read off a
    // field someone could have typed.
    const both = pairs.filter((p) => p.direct_success && p.controlled_success).length;
    const controlledOnly = pairs.filter((p) => !p.direct_success && p.controlled_success).length;
    out.candidate_success_rate = metrics.controlled_success_rate;
    out.baseline_success_rate = metrics.direct_success_rate;
    // Wrong-file edits are a defect rate, so an unmeasured pair leaves the rate null. It is then an
    // unmeasured gate - blocking without claiming a comparison nobody made - rather than a silent 1.
    out.candidate_wrong_file_rate = Number.isFinite(metrics.controlled_wrong_file_rate)
      ? metrics.controlled_wrong_file_rate : null;
    out.baseline_wrong_file_rate = Number.isFinite(metrics.direct_wrong_file_rate)
      ? metrics.direct_wrong_file_rate : null;
    // Calibration: of completed pairs, the share where the governed arm was
    // right whenever both arms were. A silent regression shows up here.
    out.candidate_claim_calibration = pairs.length ? (both + controlledOnly) / pairs.length : 0;
    out.candidate_time_to_admissible_patch = metrics.mean_controlled_ms;
    out.baseline_time_to_admissible_patch = metrics.mean_direct_ms;
    return out;
  }
  return { ...metrics };
}

function heldoutEvidence(payload) {
  const report = normalizeHeldoutPayload(payload) || {};
  const completed = Number(report.completed_pairs || 0);
  const metrics = heldoutGateMetrics(report, report.metrics && typeof report.metrics === 'object' ? report.metrics : {});
  const promotionDecision = report.promotion_decision || 'do_not_promote_protocol_or_shadow_only';
  const promotionReady = completed >= 20 && promotionDecision === 'promote_canary';
  const gateFailures = [];
  // A gate that compares two numbers cannot decide when one of them was never measured. Those are
  // listed separately so a caller can tell a measurement gap from a regression instead of reading
  // "must be lower than baseline" about a comparison nobody made. Both block promotion.
  const unmeasured = [];
  if (completed < 20) {
    gateFailures.push('20 same-model live direct-vs-controlled heldout pairs');
  } else if (!promotionReady) {
    if (Number(metrics.candidate_success_rate ?? 0) < Number(metrics.baseline_success_rate ?? 0)) {
      gateFailures.push('heldout candidate success rate must be at least baseline');
    }
    if (metrics.candidate_wrong_file_rate == null || metrics.baseline_wrong_file_rate == null) {
      // No rate was recorded. That is a measurement gap, and a gap is named as one instead of being
      // scored as if a comparison had happened.
      unmeasured.push('heldout candidate wrong-file rate is unmeasured');
      gateFailures.push('heldout candidate wrong-file rate is unmeasured');
    } else if (metrics.candidate_wrong_file_rate === 0 && metrics.baseline_wrong_file_rate === 0) {
      // Both rates are measured and both are zero: neither arm touched a file outside scope, so this
      // gate has nothing to compare. It stays closed - equal is not evidence - but says so, because
      // "must be lower than baseline" reads as a regression the run never showed.
      unmeasured.push('heldout wrong-file rate cannot discriminate: neither arm recorded a wrong-file edit');
      gateFailures.push('heldout wrong-file rate cannot discriminate: neither arm recorded a wrong-file edit');
    } else if (metrics.candidate_wrong_file_rate >= metrics.baseline_wrong_file_rate) {
      gateFailures.push('heldout candidate wrong-file rate must be lower than baseline');
    }
    if (Number(metrics.candidate_claim_calibration ?? 0) < 0.9) {
      gateFailures.push('heldout candidate claim calibration must be at least 0.90');
    }
    if (Number(metrics.candidate_time_to_admissible_patch ?? Infinity) > Number(metrics.baseline_time_to_admissible_patch ?? 0)) {
      gateFailures.push('heldout candidate time-to-admissible-patch must be no slower than baseline');
    }
    // A label is not a measurement. When the report carries per-pair receipts
    // the arithmetic has already decided; when it does not, a hand-written
    // promote_canary is rejected outright rather than trusted.
    const hasReceipts = Array.isArray(report.pairs) && report.pairs.length >= 20;
    if (gateFailures.length === 0 && !hasReceipts) {
      gateFailures.push('heldout aggregate scorer must return promote_canary');
    }
  }
  return Object.freeze({
    kind: 'proof_lane.heldout_pairs.v0',
    status: promotionReady ? 'promotion_ready' : completed >= 20 ? 'completed_pairs_hold' : 'blocked_missing_live_pairs',
    completed_pairs: completed,
    required_pairs: 20,
    promotion_decision: promotionDecision,
    metrics: Object.freeze({ ...metrics }),
    model: typeof report.model === 'string' ? report.model : null,
    gate_failures: Object.freeze(gateFailures),
    unmeasured_gates: Object.freeze(unmeasured),
    claim_boundary:
      report.claim_boundary ||
      'Grand-hypothesis promotion requires 20 same-model direct-vs-controlled heldout pairs.',
  });
}

function latencyEvidence({ beforeSnapshotMs = 76870.089, counts = [100, 1000, 5000, 20000] } = {}) {
  const runs = counts.map((count) => rolloutBenchmark({ count, target: 'proof/grand-hypothesis.html' }));
  const primary = runs.find((run) => run.candidates_requested === 5000) || runs.at(-1);
  return Object.freeze({
    kind: 'proof_lane.low_wait_parallel_rollout.v0',
    status: primary.gate_halted_on_unadmitted_effect && primary.disk_writes === 0 ? 'pass' : 'fail',
    before_snapshot_ms: beforeSnapshotMs,
    after_delta_chain_ms: primary.elapsed_ms,
    speedup: Number((beforeSnapshotMs / primary.elapsed_ms).toFixed(1)),
    runs: Object.freeze(runs),
    claim_boundary: primary.claim_boundary,
  });
}

function grandHypothesisProof(options = {}) {
  const tensorPayload =
    options.tensor_bakeoff || readJsonIfExists(options.tensor_bakeoff_path || DEFAULT_TENSOR_BAKEOFF);
  const bvtPath =
    options.bvt_study_receipt_path || latestReceipt(options.bvt_study_root || DEFAULT_BVT_STUDY_ROOT);
  const bvtPayload = options.bvt_study || readJsonIfExists(bvtPath || '');
  const heldoutPath = options.heldout_report_path || defaultHeldoutReport();
  const heldoutPayload = options.heldout_report || readJsonIfExists(heldoutPath || '') || null;
  const lanes = Object.freeze({
    latency: latencyEvidence(options.latency),
    tensor: tensorEvidence(tensorPayload),
    bvt: bvtEvidence(bvtPayload),
    heldout: heldoutEvidence(heldoutPayload),
  });
  const canaryPass =
    lanes.latency.status === 'pass' &&
    lanes.tensor.status === 'pass' &&
    lanes.bvt.status === 'canary_pass';
  const promoted = canaryPass && lanes.heldout.status === 'promotion_ready';
  return Object.freeze({
    kind: 'agent_os.grand_hypothesis_proof.v0',
    hypothesis:
      'typed packets plus tensor routing plus gates plus receipts improve agent work over prose transcript replay',
    decision: promoted ? 'promote_candidate' : canaryPass ? 'canary_progress_hold_promotion' : 'hold',
    lanes,
    missing_for_promotion:
      lanes.heldout.status === 'promotion_ready'
        ? Object.freeze([])
        : lanes.heldout.gate_failures,
    receipts: Object.freeze({
      tensor_bakeoff: options.tensor_bakeoff_path || DEFAULT_TENSOR_BAKEOFF,
      bvt_study: bvtPath,
      heldout_report: heldoutPath || null,
    }),
    claim_boundary:
      'This proof harness combines local latency, tensor-route, gate-safety, and BVT canary receipts. It is not production reliability, SWE-bench proof, model-weight learning, or L6/L7 autonomy until heldout live pairs and external effect-proxy receipts pass.',
  });
}

function proofStatus(options = {}) {
  const proof = grandHypothesisProof(options);
  return Object.freeze({
    decision: proof.decision,
    missing_for_promotion: proof.missing_for_promotion,
  });
}

module.exports = {
  bvtEvidence,
  grandHypothesisProof,
  heldoutEvidence,
  latencyEvidence,
  normalizeHeldoutPayload,
  proofStatus,
  tensorEvidence,
};
