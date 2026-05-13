'use strict';

const { O, freeze, hash } = require('./core');

const VSM = Object.freeze({
  S1: 'extraction',
  S2: 'routing',
  S3: 'control',
  S4: 'intelligence',
  S5: 'policy',
});

const CONTROL_DEFAULTS = Object.freeze({
  uncertainty: 1,
  evidence_deficit: 1,
  contradiction_pressure: 0,
  budget: 1,
  latency_pressure: 0,
  novelty_demand: 0.5,
});

const BAND_RANK = Object.freeze({
  u: 0,
  f1: 1,
  f2: 2,
  f3: 3,
  inf: 4,
});

const LANGUAGE_METRICS = Object.freeze({
  fields: 7,
  stable_verbs: 6,
  vsm_systems: 5,
  control_variables: 6,
  default_band: 'u',
});

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeControls(input = {}) {
  const next = {};
  for (const [key, fallback] of Object.entries(CONTROL_DEFAULTS)) {
    next[key] = clamp01(input[key], fallback);
  }
  return freeze(next);
}

function vectorFromControls(controls) {
  return freeze([
    controls.uncertainty,
    controls.evidence_deficit,
    controls.contradiction_pressure,
    controls.budget,
    controls.latency_pressure,
    controls.novelty_demand,
  ]);
}

function bitmaskFromControls(controls) {
  const bits = [
    controls.uncertainty > 0.5,
    controls.evidence_deficit > 0.5,
    controls.contradiction_pressure > 0.5,
    controls.budget > 0.2,
    controls.latency_pressure > 0.5,
    controls.novelty_demand > 0.5,
  ];
  return bits.reduce((mask, bit, index) => mask | (bit ? 1 << index : 0), 0);
}

function primeProductFromMask(mask) {
  const primes = [2, 3, 5, 7, 11, 13];
  return primes.reduce((product, prime, index) => {
    return mask & (1 << index) ? product * prime : product;
  }, 1);
}

function chooseVsm(intent, controls) {
  const text = String(intent || '').toLowerCase();
  if (text.includes('policy') || text.includes('govern')) return 'S5';
  if (text.includes('search') || text.includes('extract') || text.includes('recover')) return 'S1';
  if (text.includes('route') || text.includes('surface')) return 'S2';
  if (text.includes('prove') || text.includes('gate') || controls.evidence_deficit > 0.7) return 'S3';
  return 'S4';
}

function chooseVerb(vsm, controls, effect) {
  if (effect) return O.GATE;
  if (vsm === 'S1') return O.OBSERVE;
  if (vsm === 'S2') return O.SELECT;
  if (vsm === 'S3') return O.GATE;
  if (vsm === 'S5') return O.RECEIPT;
  if (controls.uncertainty > 0.6 || controls.novelty_demand > 0.6) return O.TRANSFORM;
  return O.SELECT;
}

function chooseBand(packet) {
  const { gate, psi } = packet;
  if (gate.decision === 'admit' && psi.evidence_deficit < 0.25) return 'f3';
  if (gate.decision === 'shadow') return 'f1';
  if (gate.decision === 'hold' && psi.evidence_deficit < 0.7) return 'f2';
  return 'u';
}

function decisionFor({ effect = false, rollback = '', claim_boundary = '', evidence = [] } = {}) {
  if (effect && (!rollback || !claim_boundary)) return 'hold';
  if (effect && evidence.length === 0) return 'shadow';
  return effect ? 'admit' : 'hold';
}

function unityPacket(input = {}) {
  const control = normalizeControls(input.control);
  const mask = bitmaskFromControls(control);
  const vsm = input.vsm || chooseVsm(input.intent, control);
  const verb = input.verb || chooseVerb(vsm, control, input.effect);
  const gate = freeze({
    decision: input.decision || decisionFor(input),
    rollback: input.rollback || '',
    claim_boundary: input.claim_boundary || 'language packet only; not proof of external effect',
    receipt_required: input.receipt_required !== false,
  });
  const packet = freeze({
    kind: 'unity.kernel.packet.v0',
    intent: input.intent || '',
    psi: control,
    vsm: freeze({ id: vsm, role: VSM[vsm] }),
    carrier: freeze({
      bitmask: mask,
      prime_product: primeProductFromMask(mask),
      vector: vectorFromControls(control),
      hash: '',
    }),
    transition: freeze({
      S: input.state || '',
      delta: input.delta || '',
      C: input.constraint || '',
      S_prime: input.next_state || '',
    }),
    verb: verb.description,
    gate,
    metrics: LANGUAGE_METRICS,
  });
  return freeze({
    ...packet,
    carrier: freeze({
      ...packet.carrier,
      hash: hash({
        intent: packet.intent,
        psi: packet.psi,
        vsm: packet.vsm,
        transition: packet.transition,
        gate: packet.gate,
      }),
    }),
    band: chooseBand(packet),
  });
}

function transitionText(packet) {
  return `${packet.transition.S} + ${packet.transition.delta} + ${packet.transition.C} -> ${packet.transition.S_prime}`;
}

module.exports = {
  BAND_RANK,
  CONTROL_DEFAULTS,
  LANGUAGE_METRICS,
  VSM,
  bitmaskFromControls,
  chooseBand,
  chooseVerb,
  chooseVsm,
  normalizeControls,
  primeProductFromMask,
  transitionText,
  unityPacket,
  vectorFromControls,
};
