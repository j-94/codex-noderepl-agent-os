'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { K, O, hash, init, op, readMem, step } = require('./core');
const { createRuliad, invalidateLesson, recordExperience, selectRmeCut } = require('./rme');
const { choose, dominates, frontier, score, surface } = require('./surface');

const BITS = Object.freeze({
  A: 1,   // Alignment: goal understood to spec
  U: 2,   // Uncertainty: missing information or ambiguity
  E: 4,   // Error: runtime error or test failure
  D: 8,   // Drift: context/scope drift detected (alias Δ)
  I: 16,  // Interrupt / Instruction: external steer or directive
  M: 32,  // Meta / Mutate: revision required
  P: 64,  // Permission: approved / admitted by gate
  R: 128, // Recovery: counterexample retraction / recovery mode
  T: 256, // Trust: verified with receipt / proof hash
});
const RESERVED_KEYS = new Set(['policy', 'history', 'learner', 'meta', 'ruliad', 'matrix']);

function maskToString(mask) {
  return Object.entries(BITS)
    .filter(([, bit]) => (mask & bit) !== 0)
    .map(([name]) => (name === 'D' ? 'Δ' : name))
    .join('|') || '0';
}

/**
 * Evaluates the foundational Meta-Cybernetic control law:
 * Act <=> A=1 (aligned) AND P=1 (permitted) AND no error, drift, or unresolved uncertainty.
 */
function evalActLaw(bits) {
  const mask = typeof bits === 'number' ? bits : 0;
  const isAligned = (mask & BITS.A) !== 0;
  const isPermitted = (mask & BITS.P) !== 0;
  const hasBlocker = (mask & (BITS.E | BITS.D | BITS.U)) !== 0;
  return isAligned && isPermitted && !hasBlocker;
}

function compilePolicy(source) {
  if (!source) return null;
  const context = vm.createContext(Object.create(null));
  return vm.runInContext(`(${source})`, context, {
    timeout: 50,
    codeGeneration: { strings: false, wasm: false }
  });
}

function viewMem(state) {
  return Object.fromEntries(
    state.mem.filter(([k]) => !RESERVED_KEYS.has(k)).map(([k, v]) => [k, v.value])
  );
}

function cleanMemPatch(patch) {
  if (!patch || typeof patch !== 'object') return {};
  return Object.fromEntries(
    Object.entries(patch).filter(([k]) => !RESERVED_KEYS.has(k))
  );
}

function extractIntentTokens(input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input || {});
  const matches = raw.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  const filtered = matches.filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  return [...new Set(filtered.length ? filtered : ['bit_tape', 'policy'])].slice(0, 16);
}

/**
 * Wraps the host world adapter W so that W.read(query) automatically performs
 * proof-carrying Ruliad graph retrieval (selectRmeCut) when state.mem['ruliad'] is present.
 */
function createTapeWorld(state, W = {}) {
  const ruliad = readMem(state, 'ruliad')?.value || null;
  const baseRead = typeof W.read === 'function' ? W.read : (q) => ({ query_received: q, candidates: [] });
  const baseStat = typeof W.stat === 'function' ? W.stat : () => 'ok';
  const baseExec = typeof W.exec === 'function' ? W.exec : (call) => ({ executed: call });

  return {
    read: (query) => {
      const res = baseRead(query);
      if (!ruliad) return res;
      try {
        const intentTerms = extractIntentTokens(
          typeof query === 'object' && query !== null
            ? query.prompt || query.query || query.intent || query
            : query
        );
        const cut = selectRmeCut(ruliad, { intent: intentTerms.join(' ') });
        const lessons = cut.nodes
          .filter((n) => n.type === 'lesson')
          .map((n) => ({ id: n.id, summary: n.data.summary, action: n.data.action, terms: n.data.terms }));
        if (res && typeof res === 'object' && !Array.isArray(res)) {
          return {
            ...res,
            rmeCut: {
              graphHash: cut.graphHash,
              lessonIds: cut.lessonIds,
              lessons,
            },
          };
        }
        return res;
      } catch {
        return res;
      }
    },
    stat: (target) => {
      if (typeof target !== 'string' || target.length === 0) {
        throw new Error('Invalid world stat target');
      }
      return baseStat(target);
    },
    exec: baseExec,
  };
}

function updateTapeRuliad(state, { bits, packet, policySource, previousPolicySource, hadCollision, reason }) {
  let ruliad = readMem(state, 'ruliad')?.value || null;
  if (!ruliad) {
    ruliad = createRuliad({ purpose: 'agent_os.bit_tape.v1' });
  }
  const pktHash = hash(packet || {});
  const polHash = hash(policySource || '');

  if (hadCollision && previousPolicySource) {
    const prevAct = `Execute policy:${hash(previousPolicySource)}`;
    const prevLesson = [...ruliad.nodes].reverse().find((n) => n.type === 'lesson' && n.data.action === prevAct);
    if (prevLesson) {
      const alreadyInvalidated = ruliad.nodes.some(
        (n) => n.type === 'counterexample' && n.data.lesson === prevLesson.id
      );
      if (!alreadyInvalidated) {
        ruliad = invalidateLesson(ruliad, {
          lessonId: prevLesson.id,
          reason: reason || `Collision on [${maskToString(bits)}]`,
          evidence: [{ path: `mem://bit_tape/collision/${pktHash}`, sha256: pktHash }],
        });
      }
    }
  }

  const terms = extractIntentTokens({
    kind: packet?.kind || 'packet',
    event: packet?.event || null,
    instruction: packet?.instruction || null,
    prompt: packet?.prompt || null,
    keys: Object.keys(packet || {}),
  });

  ruliad = recordExperience(ruliad, {
    task: {
      id: `tape-step-${state.head + 1}-${pktHash.slice(0, 12)}`,
      intent: `Resolve [${maskToString(bits)}] on ${packet?.kind || packet?.event || 'tape_packet'}`,
    },
    observation: {
      summary: `Packet ${pktHash.slice(0, 12)} triggered [${maskToString(bits)}]`,
    },
    evidence: [{ path: `mem://bit_tape/packet/${pktHash}`, sha256: pktHash }],
    verification: {
      passed: true,
      verifier: 'bit_tape.verifyOnTape.v1',
      command: 'verifyOnTape + surface.frontier',
      evidence: [{ path: `mem://bit_tape/policy/${polHash}`, sha256: polHash }],
    },
    lesson: {
      summary: `Verified policy ${polHash.slice(0, 12)} on [${maskToString(bits)}]`,
      action: `Execute policy:${polHash}`,
      terms,
    },
  });

  return step(state, op(K.WRITE, { key: 'ruliad', value: ruliad }));
}

/**
 * Verifies a candidate policy function against recorded tape history before admission:
 * - Supports both single-turn packets and multi-turn episodes (sequential memPatch carry-forward).
 * - Packets recorded with E=1 (known bad/drifted) must NOT be admitted to run W.write/W.exec.
 * - Packets recorded with E=0 (known valid) must remain admitted.
 * - Conversational/stance interventions (I=1) must persist non-inert state in memPatch.
 */
function verifyOnTape(fn, history, W, currentIntervention = null) {
  const episodeMem = new Map();
  let validCount = 0;
  let safetyHoldCount = 0;
  const cellCounts = new Map();

  for (const past of history) {
    // Support multi-turn episode records { id, turns: [...], expected }
    if (Array.isArray(past.turns) && past.turns.length > 0) {
      let simMem = { ...(past.mem_before || {}) };
      let lastOut = null;
      for (const turn of past.turns) {
        const turnPkt = turn.packet || turn;
        const turnWorld = turn.world || past.world || null;
        const probeW = {
          read: (arg) => (turnWorld ? turnWorld[arg] : W.read(arg)),
          stat: (arg) => {
            if (!turnWorld) return W.stat(arg);
            if (typeof arg !== 'string' || !Object.hasOwn(turnWorld, arg)) throw new Error('Invalid world stat target');
            return turnWorld[arg];
          },
        };
        lastOut = fn(simMem, turnPkt, probeW);
        simMem = { ...simMem, ...cleanMemPatch(lastOut?.memPatch) };
      }
      const failedEpisode =
        past.expected === 'HOLD' || ((past.bits || 0) & BITS.E) !== 0;
      const cellKey = `${past.turns[past.turns.length - 1]?.packet?.kind || 'episode'}:${Boolean(lastOut?.admit)}`;
      const cell = cellCounts.get(cellKey) || { valid: 0, trap: 0 };
      if (failedEpisode) cell.trap += 1;
      else cell.valid += 1;
      cellCounts.set(cellKey, cell);

      if (failedEpisode && lastOut?.admit === true) {
        return {
          ok: false,
          reason: `Candidate policy failed to hold known error episode #${past.id || past.seq}`,
        };
      }
      if (!failedEpisode && lastOut?.admit !== true) {
        return {
          ok: false,
          reason: `Candidate policy broke known valid episode #${past.id || past.seq} (simMem=${JSON.stringify(simMem)})`,
        };
      }
      if (failedEpisode) safetyHoldCount += 1;
      else validCount += 1;
      continue;
    }

    const probeW = {
      read: (arg) => (past.world ? past.world[arg] : W.read(arg)),
      stat: (arg) => {
        if (!past.world) return W.stat(arg);
        if (typeof arg !== 'string' || !Object.hasOwn(past.world, arg)) throw new Error('Invalid world stat target');
        return past.world[arg];
      },
    };

    if (past.bits & BITS.I) {
      if (past.episode_id) {
        const prevMem = episodeMem.get(past.episode_id) || past.mem_before || {};
        const iOut = fn(prevMem, past.packet, probeW);
        episodeMem.set(past.episode_id, { ...prevMem, ...cleanMemPatch(iOut?.memPatch) });
      }
      continue;
    }

    const effectiveMem = past.episode_id
      ? episodeMem.get(past.episode_id) || past.mem_before || {}
      : past.mem_before || {};
    const out = fn(effectiveMem, past.packet, probeW);
    if (past.episode_id) {
      episodeMem.set(past.episode_id, { ...effectiveMem, ...cleanMemPatch(out?.memPatch) });
    }

    const isFinalCheck = past.check_decision !== false;
    if (!isFinalCheck) continue;

    const failedBefore = (past.bits & BITS.E) !== 0 || past.expected === 'HOLD';
    const cellKey = `${past.packet?.kind || past.packet?.event || 'pkt'}:${Boolean(out?.admit)}`;
    const cell = cellCounts.get(cellKey) || { valid: 0, trap: 0 };
    if (failedBefore) cell.trap += 1;
    else cell.valid += 1;
    cellCounts.set(cellKey, cell);

    if (failedBefore && out.admit === true) {
      return { ok: false, reason: `Candidate policy failed to hold known error packet #${past.seq}` };
    }
    if (!failedBefore && out.admit !== true) {
      return { ok: false, reason: `Candidate policy broke known valid packet #${past.seq}` };
    }
    if (failedBefore) safetyHoldCount += 1;
    else validCount += 1;
  }

  let interventionScore = 1;
  if (currentIntervention) {
    const probeW = { read: (arg) => W.read(arg), stat: (arg) => W.stat(arg) };
    const iOut = fn(currentIntervention.memBefore, currentIntervention.packet, probeW);
    const patch = cleanMemPatch(iOut?.memPatch);
    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 0) {
      return { ok: false, reason: 'Intervention I=1 must persist stance/state in memPatch' };
    }
    const memAfter = {
      ...currentIntervention.memBefore,
      ...patch,
    };
    const probePkt = { bits: BITS.A, prompt: 'probe' };
    const beforeProbe = fn(currentIntervention.memBefore, probePkt, probeW);
    const afterProbe = fn(memAfter, probePkt, probeW);
    if (beforeProbe.admit === afterProbe.admit) {
      return {
        ok: false,
        reason: 'Intervention I=1 did not change prompt admission (admit) between memBefore and memAfter',
      };
    }
    interventionScore = 2;
  }

  const collidingCells = [...cellCounts.entries()]
    .filter(([, counts]) => counts.valid > 0 && counts.trap > 0)
    .map(([cellKey, counts]) => ({ cellKey, ...counts }));

  return {
    ok: true,
    validCount,
    safetyHoldCount,
    interventionScore,
    quotientCells: Object.fromEntries(cellCounts),
    collidingCells,
  };
}

/**
 * Scores one or more candidate policies across targetHistory using src/surface.js
 * Pareto metrics [LATENCY, EVIDENCE, SAFETY, RECEIPT, WEIGHT] and selects the frontier winner.
 */
function evaluatePolicyMatrix(candidateSources, targetHistory, W, currentIntervention = null) {
  const sources = (Array.isArray(candidateSources) ? candidateSources : [candidateSources]).filter(Boolean);
  const verifiedItems = [];
  let lastFailure = { reason: 'No candidate policy provided' };

  for (const src of sources) {
    try {
      const fn = compilePolicy(src);
      const check = verifyOnTape(fn, targetHistory, W, currentIntervention);
      if (!check.ok) {
        lastFailure = { rejectedPolicy: src, reason: check.reason };
        continue;
      }
      const latencyBucket = Math.max(1, targetHistory.length);
      const weightBucket = Math.max(1, Math.ceil(src.length / 128));
      const metrics = [
        latencyBucket,
        check.validCount + check.safetyHoldCount,
        check.safetyHoldCount,
        check.interventionScore,
        weightBucket,
      ];
      const surf = surface([O.OBSERVE, O.SELECT, O.GATE, O.RECEIPT], metrics, {
        source: src,
        fn,
        check,
      });
      verifiedItems.push(surf);
    } catch (err) {
      lastFailure = { rejectedPolicy: src, reason: `Compile/runtime error: ${err.message}` };
    }
  }

  if (verifiedItems.length === 0) {
    return { ok: false, counterexample: lastFailure };
  }

  const paretoFrontier = frontier(verifiedItems);
  const chosen = choose(paretoFrontier, O.GATE);
  return {
    ok: true,
    selectedSource: chosen.call.source,
    selectedFn: chosen.call.fn,
    selectedMetrics: chosen.metrics,
    selectedScore: score(chosen),
    frontierSize: paretoFrontier.length,
    quotientCells: chosen.call.check.quotientCells,
    collidingCells: chosen.call.check.collidingCells,
  };
}

/**
 * The entire bit-stream computer on top of src/core.js:
 * - If M=0 and a compiled policy exists on the tape, it runs in <0.1ms with 0 LM calls and drives W.
 * - If M=1 (boot fault, E=1 error, Δ=1 drift, U=1 uncertainty, or I=1 human intervention),
 *   the LM inspects (current policy, tape history, packet) and writes a new policy onto the tape,
 *   verified by sequential replay, scored by the Surface Pareto matrix, and sealed into the Ruliad graph.
 */
async function sendPacket(state, packet, { W, synthesizePolicy, disableRevision = false }) {
  const history = readMem(state, 'history')?.value || [];
  let policySource = readMem(state, 'policy')?.value || null;
  let policyFn = compilePolicy(policySource);
  const tapeW = createTapeWorld(state, W);

  let bits = packet.bits || BITS.A;
  if (disableRevision && policyFn && (bits & BITS.I) && !(bits & BITS.A)) {
    return {
      state,
      trace: {
        bits: maskToString(bits),
        metaUpdated: false,
        lmMs: 0,
        exactMs: 0,
        decision: 'REVISION_DISABLED',
        wCall: null,
        wResult: null,
        memAfter: viewMem(state),
        policyHash: policySource ? hash(policySource) : null,
        policySource,
      },
    };
  }
  const memBefore = viewMem(state);
  const isErrorPacket = (bits & (BITS.E | BITS.D)) !== 0;
  const tPre = performance.now();
  let preDecision = null;
  let prePolicyFailure = null;
  try {
    preDecision = policyFn ? policyFn(memBefore, packet, { read: tapeW.read, stat: tapeW.stat }) : null;
  } catch (error) {
    prePolicyFailure = error;
    bits |= BITS.E | BITS.M;
  }
  const preExactMs = performance.now() - tPre;
  const hasCollision =
    Boolean(policyFn) &&
    (Boolean(prePolicyFailure) ||
      (isErrorPacket && preDecision.admit === true) ||
      (!isErrorPacket && !(bits & BITS.I) && packet.knownValid === true && preDecision.admit !== true));

  if (!policyFn || (!disableRevision && ((bits & BITS.I) || hasCollision || (bits & BITS.M)))) {
    bits |= BITS.M;
  }

  let metaUpdated = false;
  let lmMs = 0;

  // M = 1 Interrupt: Objectify the current policy on the tape and synthesize its replacement (with CEGAR + Pareto Matrix selection)
  if ((bits & BITS.M) && !disableRevision) {
    const t0 = performance.now();
    const targetHistory =
      bits & BITS.I
        ? history
        : [
            ...history,
            {
              seq: history.length + 1,
              bits,
              packet,
              world: packet.worldSnapshot || null,
              mem_before: memBefore,
              episode_id: packet.episode_id || null,
            },
          ];
    let counterexample = null;
    let matrixEval = null;
    const previousPolicySource = policySource;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const synthesized = await synthesizePolicy({
        bits: maskToString(bits),
        currentPolicySource: policySource,
        history,
        mem: memBefore,
        packet,
        counterexample,
      });
      matrixEval = evaluatePolicyMatrix(
        synthesized,
        targetHistory,
        tapeW,
        bits & BITS.I ? { memBefore, packet } : null
      );
      if (matrixEval.ok) {
        counterexample = null;
        break;
      }
      counterexample = matrixEval.counterexample;
    }
    lmMs = performance.now() - t0;
    if (counterexample || !matrixEval?.ok) {
      throw new Error(`Tape replay rejected policy: ${counterexample?.reason || 'unknown failure'}`);
    }

    state = step(state, op(K.WRITE, { key: 'policy', value: matrixEval.selectedSource }));
    state = step(
      state,
      op(K.WRITE, {
        key: 'matrix',
        value: {
          metrics: matrixEval.selectedMetrics,
          score: matrixEval.selectedScore,
          frontierSize: matrixEval.frontierSize,
          quotientCells: matrixEval.quotientCells,
          collidingCells: matrixEval.collidingCells,
        },
      })
    );
    state = updateTapeRuliad(state, {
      bits,
      packet,
      policySource: matrixEval.selectedSource,
      previousPolicySource,
      hadCollision: hasCollision,
      reason: `Collision on [${maskToString(bits)}]`,
    });
    state = step(state, op(K.ADMIT, { reason: `Promoted policy on [${maskToString(bits)}]` }));
    policySource = matrixEval.selectedSource;
    policyFn = matrixEval.selectedFn;
    metaUpdated = true;
  }

  // M = 0 / Post-Interrupt Execution: Inhabit the policy on the tape
  let decision = preDecision;
  let exactMs = preExactMs;
  if (metaUpdated || !decision) {
    const refreshedW = createTapeWorld(state, W);
    const tExact = performance.now();
    try {
      decision = policyFn(memBefore, packet, { read: refreshedW.read, stat: refreshedW.stat });
    } catch (error) {
      decision = { admit: false, reason: `Policy runtime error: ${error.message}`, wCall: null, memPatch: {} };
    }
    exactMs = performance.now() - tExact;
  }

  if (decision.memPatch && typeof decision.memPatch === 'object') {
    for (const [k, v] of Object.entries(decision.memPatch)) {
      if (RESERVED_KEYS.has(k)) continue;
      state = step(state, op(K.WRITE, { key: k, value: v }));
    }
  }

  // If packet is a pure conversational intervention (I=1 without A=1), do not execute W.exec
  if ((bits & BITS.I) && !(bits & BITS.A)) {
    return {
      state,
      trace: {
        bits: maskToString(bits),
        metaUpdated,
        lmMs: Math.round(lmMs),
        exactMs: Number(exactMs.toFixed(3)),
        decision: 'POLICY_REVISED',
        wCall: decision.wCall || null,
        wResult: null,
        memAfter: viewMem(state),
        policyHash: policySource ? hash(policySource) : null,
        policySource,
      },
    };
  }

  let wResult = null;
  if (decision.admit && decision.wCall) {
    state = step(state, op(K.PLAN, decision.wCall));
    wResult = tapeW.exec(decision.wCall);
  }

  const nextHistory = [
    ...history,
    {
      seq: history.length + 1,
      bits,
      packet,
      world: packet.worldSnapshot || null,
      mem_before: memBefore,
      episode_id: packet.episode_id || null,
      decision,
    },
  ];
  state = step(state, op(K.WRITE, { key: 'history', value: nextHistory }));

  return {
    state,
    trace: {
      bits: maskToString(bits),
      metaUpdated,
      lmMs: Math.round(lmMs),
      exactMs: Number(exactMs.toFixed(3)),
      decision: decision.admit ? 'ADMIT_W' : `HOLD_W (${decision.reason || 'blocked'})`,
      wCall: decision.wCall || null,
      wResult,
      memAfter: viewMem(state),
      policyHash: policySource ? hash(policySource) : null,
      policySource,
    },
  };
}

/**
 * Verifiably inserts a {dataset} (single-turn packets or multi-turn episodes) into the tape:
 * 1. Streams {dataset} at M=0 (~4.9us/item) to separate already-supported rows from collisions (E=1).
 * 2. Invokes M=1 synthesis ONLY on colliding rows (with contrasting valid examples).
 * 3. Enforces strict non-regression across (Prior History U {dataset}) via verifyOnTape + Surface Pareto dominance,
 *    and seals the verified transition into state.mem['ruliad'] and state.mem['matrix'].
 */
async function insertDataset(state, dataset, { W = {}, synthesizePolicy, maxAttempts = 3 } = {}) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const priorHistory = readMem(state, 'history')?.value || [];
  let policySource = readMem(state, 'policy')?.value || null;
  let policyFn = compilePolicy(policySource);
  const tapeW = createTapeWorld(state, W);

  const normalizedRows = rows.map((row, idx) => {
    if (Array.isArray(row.turns) && row.turns.length > 0) {
      const isHold = row.expected === 'HOLD' || ((row.bits || 0) & BITS.E) !== 0;
      return {
        seq: priorHistory.length + idx + 1,
        id: row.id || `dataset_ep_${idx + 1}`,
        turns: row.turns,
        expected: isHold ? 'HOLD' : 'ADMIT',
        bits: isHold ? BITS.A | BITS.E : BITS.A,
        mem_before: row.mem_before || {},
        world: row.world || null,
      };
    }
    const pkt = row.packet || row;
    const isHold =
      row.expected === 'HOLD' ||
      ((row.bits || pkt.bits || 0) & BITS.E) !== 0 ||
      row.outcome === 'test_failed' ||
      row.outcome === 'user_corrected';
    return {
      seq: priorHistory.length + idx + 1,
      id: row.id || pkt.id || `dataset_pkt_${idx + 1}`,
      bits: isHold ? BITS.A | BITS.E : BITS.A,
      expected: isHold ? 'HOLD' : 'ADMIT',
      packet: { ...pkt, bits: isHold ? BITS.A | BITS.E : BITS.A, knownValid: !isHold },
      world: row.world || pkt.worldSnapshot || null,
      mem_before: row.mem_before || {},
      episode_id: row.episode_id || pkt.episode_id || null,
    };
  });

  // Phase 1: Stream {dataset} at M=0 to isolate collisions without spending LM tokens
  const tStream0 = performance.now();
  const m0Supported = [];
  const collisions = [];

  for (const item of normalizedRows) {
    if (!policyFn) {
      collisions.push(item);
      continue;
    }
    const singleCheck = verifyOnTape(policyFn, [item], tapeW, null);
    if (singleCheck.ok) m0Supported.push(item);
    else collisions.push(item);
  }
  const m0StreamMs = Number((performance.now() - tStream0).toFixed(3));

  let lmCallsSpent = 0;
  let lmSynthesisMs = 0;
  let metaUpdated = false;
  const combinedHistory = [...priorHistory, ...normalizedRows];

  // Phase 2: If collisions exist, trigger M=1 synthesis on the colliding contrast set
  if (collisions.length > 0) {
    if (typeof synthesizePolicy !== 'function') {
      throw new Error(`Dataset insertion found ${collisions.length} collision(s) but no synthesizePolicy provided`);
    }
    const tSynth0 = performance.now();
    const firstCollision = collisions[0];
    const collisionPacket = Array.isArray(firstCollision.turns)
      ? firstCollision.turns[firstCollision.turns.length - 1].packet
      : firstCollision.packet;
    let counterexample = null;
    let matrixEval = null;
    const previousPolicySource = policySource;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lmCallsSpent += 1;
      const candidate = await synthesizePolicy({
        bits: maskToString(BITS.A | BITS.E | BITS.M),
        currentPolicySource: policySource,
        history: [...priorHistory, ...m0Supported, ...collisions],
        collisions,
        contrastValid: m0Supported.slice(0, 4),
        mem: viewMem(state),
        packet: collisionPacket,
        counterexample,
      });
      matrixEval = evaluatePolicyMatrix(candidate, combinedHistory, tapeW, null);
      if (matrixEval.ok) {
        counterexample = null;
        break;
      }
      counterexample = matrixEval.counterexample;
    }
    lmSynthesisMs = Math.round(performance.now() - tSynth0);
    if (counterexample || !matrixEval?.ok) {
      throw new Error(`Dataset insertion rejected by tape replay: ${counterexample?.reason || 'unknown'}`);
    }

    state = step(state, op(K.WRITE, { key: 'policy', value: matrixEval.selectedSource }));
    state = step(
      state,
      op(K.WRITE, {
        key: 'matrix',
        value: {
          metrics: matrixEval.selectedMetrics,
          score: matrixEval.selectedScore,
          frontierSize: matrixEval.frontierSize,
          quotientCells: matrixEval.quotientCells,
          collidingCells: matrixEval.collidingCells,
        },
      })
    );
    state = updateTapeRuliad(state, {
      bits: BITS.A | BITS.E | BITS.M,
      packet: collisionPacket,
      policySource: matrixEval.selectedSource,
      previousPolicySource,
      hadCollision: Boolean(previousPolicySource),
      reason: `Dataset insertion resolved ${collisions.length} collision(s)`,
    });
    state = step(
      state,
      op(K.ADMIT, { reason: `Inserted dataset (${normalizedRows.length} rows, ${collisions.length} collisions resolved)` })
    );
    policySource = matrixEval.selectedSource;
    policyFn = matrixEval.selectedFn;
    metaUpdated = true;
  } else if (policyFn && normalizedRows.length > 0) {
    // 0 collisions: update matrix and record dataset support at M=0
    const matrixEval = evaluatePolicyMatrix(policySource, combinedHistory, tapeW, null);
    if (matrixEval.ok) {
      state = step(
        state,
        op(K.WRITE, {
          key: 'matrix',
          value: {
            metrics: matrixEval.selectedMetrics,
            score: matrixEval.selectedScore,
            frontierSize: matrixEval.frontierSize,
            quotientCells: matrixEval.quotientCells,
            collidingCells: matrixEval.collidingCells,
          },
        })
      );
    }
  }

  state = step(state, op(K.WRITE, { key: 'history', value: combinedHistory }));
  const ruliad = readMem(state, 'ruliad')?.value || null;
  const matrix = readMem(state, 'matrix')?.value || null;

  return {
    state,
    receipt: {
      totalDatasetRows: normalizedRows.length,
      priorHistoryRows: priorHistory.length,
      m0SupportedCount: m0Supported.length,
      collisionsIsolated: collisions.length,
      m0StreamMs,
      lmCallsSpent,
      lmSynthesisMs,
      metaUpdated,
      verifiedTotalHistory: combinedHistory.length,
      policyHash: policySource ? hash(policySource) : null,
      ruliadHash: ruliad ? ruliad.hash : null,
      ruliadLessonCount: ruliad ? ruliad.nodes.filter((n) => n.type === 'lesson').length : 0,
      ruliadCounterexampleCount: ruliad ? ruliad.nodes.filter((n) => n.type === 'counterexample').length : 0,
      matrixMetrics: matrix ? matrix.metrics : null,
      matrixCollidingCells: matrix ? matrix.collidingCells : [],
    },
  };
}

function saveTape(filePath, state) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const entries = state.mem.map(([key, blob]) => [key, blob.value]);
  const payload = { kind: 'agent_os.bit_tape.v1', head: state.head, entries };
  fs.writeFileSync(target, JSON.stringify({ ...payload, hash: hash(payload) }, null, 2) + '\n', 'utf8');
}

function loadTape(filePath) {
  const target = path.resolve(filePath);
  if (!fs.existsSync(target)) return init();
  const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
  const { hash: recorded, ...payload } = raw;
  if (payload.kind !== 'agent_os.bit_tape.v1' || recorded !== hash(payload)) {
    throw new Error('Bit-tape checkpoint hash mismatch');
  }
  let state = init();
  for (const [key, value] of payload.entries || []) {
    state = step(state, op(K.WRITE, { key, value }));
  }
  return state;
}

module.exports = {
  BITS,
  RESERVED_KEYS,
  compilePolicy,
  createTapeWorld,
  evalActLaw,
  evaluatePolicyMatrix,
  init,
  insertDataset,
  loadTape,
  maskToString,
  saveTape,
  sendPacket,
  verifyOnTape,
  viewMem,
};
