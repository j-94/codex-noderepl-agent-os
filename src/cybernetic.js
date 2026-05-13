'use strict';

const BAND_RANK = Object.freeze({ u: 0, f1: 1, f2: 2, f3: 3, inf: 4 });

function bandRank(band) {
  return BAND_RANK[band] ?? -1;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function candidateScore(candidate, options = {}) {
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0;
  const evidence = clamp01(candidate.evidence || 0);
  const rollback = candidate.rollback ? 1 : 0;
  const receipt = candidate.receipt ? 1 : 0;
  const relevance = clamp01(candidate.relevance || 0);
  const cost = clamp01(candidate.cost || 0);
  const band = bandRank(candidate.band || 'u') / bandRank('inf');
  const exploration = temperature * clamp01(candidate.novelty || 0);
  return evidence * 3 + rollback * 2 + receipt * 2 + relevance * 2 + band - cost + exploration;
}

function annealCandidates(candidates, options = {}) {
  return Object.freeze([...candidates]
    .map((candidate) => Object.freeze({ ...candidate, score: candidateScore(candidate, options) }))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))));
}

function selectCandidate(candidates, options = {}) {
  return annealCandidates(candidates, options)[0] || null;
}

function tapeEvent({ id, state, delta, control, nextState, receipt }) {
  return Object.freeze({
    kind: 'bvt.cybernetic_tape.event.v0',
    id,
    S: state,
    delta,
    C: Object.freeze({ ...control }),
    S_prime: nextState,
    receipt,
  });
}

function replayEvents(events, minimumBand = 'f2') {
  const min = bandRank(minimumBand);
  return Object.freeze(events.filter((event) => {
    const band = event && event.C && event.C.promotion_band;
    return bandRank(band) >= min;
  }));
}

module.exports = {
  BAND_RANK,
  annealCandidates,
  bandRank,
  candidateScore,
  replayEvents,
  selectCandidate,
  tapeEvent,
};
