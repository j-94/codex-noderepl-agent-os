'use strict';

/**
 * Executable Algebra of Distinctions, Composable Procedures, Reflection, and Equivalence
 * Version: agent_os.algebra.v1
 *
 * Extracted from overlapping mechanisms in:
 * - src/quotient_gate.js & src/boundary_discovery.js (serializable AST predicates & leaf-difference refinement)
 * - src/paired_boundary.js (collision detection, distinguishing rule synthesis, and freezeA non-regression)
 * - src/executable_qbl.js (situational valid_while hash verification before dependent steps)
 * - src/core.js & src/effect_proxy.js (append-only state, internal READ/WRITE, and admission boundary)
 */

const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual: equal } = require('node:util');
const { K, cell, hash, init, readMem, step, snapshot } = require('./core');
const { validateAdmission } = require('./effect_proxy');

const INTERPRETER_VERSION = 'agent_os.algebra.v1';
const DISTINCTION_SCHEMA = 'agent_os.algebra.distinction.v1';
const PROCEDURE_SCHEMA = 'agent_os.algebra.procedure.v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getAtPath(obj, dotPath) {
  if (typeof dotPath !== 'string' || !dotPath) return undefined;
  return dotPath.split('.').reduce((acc, part) => {
    if (acc !== null && typeof acc === 'object' && Object.hasOwn(acc, part)) {
      return acc[part];
    }
    return undefined;
  }, obj);
}

function collectLeafPaths(value, allowedPrefixes = null, prefix = '', depth = 0, out = []) {
  if (depth > 8 || out.length > 512) return out;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (prefix) {
      const topScope = prefix.split('.')[0];
      if (!allowedPrefixes || allowedPrefixes.includes(topScope)) {
        out.push({ path: prefix, value });
      }
    }
    return out;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (!k || k.includes('.')) continue;
    collectLeafPaths(v, allowedPrefixes, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  }
  return out;
}

// ============================================================================
// A. DISTINCTIONS (Refinement Order <= and Product / Tensor ⊗)
// ============================================================================

function pathDistinction(name, pathStr, options = {}) {
  return {
    schema: DISTINCTION_SCHEMA,
    name,
    op: 'path',
    path: pathStr,
    requires_mem: options.requires_mem || null,
    requires_observation: options.requires_observation || null,
  };
}

function eqPathsDistinction(name, leftPath, rightPath, options = {}) {
  return {
    schema: DISTINCTION_SCHEMA,
    name,
    op: 'eq_paths',
    left_path: leftPath,
    right_path: rightPath,
    requires_mem: options.requires_mem || null,
    requires_observation: options.requires_observation || null,
  };
}

function predDistinction(name, expr, options = {}) {
  return {
    schema: DISTINCTION_SCHEMA,
    name,
    op: 'pred',
    expr: clone(expr),
    requires_mem: options.requires_mem || null,
    requires_observation: options.requires_observation || null,
  };
}

function tensor(leftD, rightD) {
  if (leftD?.schema !== DISTINCTION_SCHEMA || rightD?.schema !== DISTINCTION_SCHEMA) {
    throw new Error('tensor requires two valid distinction.v1 descriptors');
  }
  return {
    schema: DISTINCTION_SCHEMA,
    name: `(${leftD.name}⊗${rightD.name})`,
    op: 'tensor',
    left: clone(leftD),
    right: clone(rightD),
  };
}

function evalExpr(expr, ctx, missingPaths = []) {
  if (!expr || typeof expr !== 'object') throw new Error('Invalid expression AST node');
  switch (expr.op) {
    case 'literal':
      return expr.value;
    case 'path': {
      const val = getAtPath(ctx, expr.path);
      if (val === undefined) missingPaths.push(expr.path);
      return val;
    }
    case 'defined': {
      const val = getAtPath(ctx, expr.path);
      return val !== undefined && val !== null;
    }
    case 'eq': {
      const l = evalExpr(expr.left, ctx, missingPaths);
      const r = evalExpr(expr.right, ctx, missingPaths);
      if (l === undefined || r === undefined) return false;
      return equal(l, r);
    }
    case 'neq': {
      const l = evalExpr(expr.left, ctx, missingPaths);
      const r = evalExpr(expr.right, ctx, missingPaths);
      if (l === undefined || r === undefined) return false;
      return !equal(l, r);
    }
    case 'and': {
      const args = (expr.args || []).map(a => evalExpr(a, ctx, missingPaths));
      return args.every(v => v === true);
    }
    case 'or': {
      const args = (expr.args || []).map(a => evalExpr(a, ctx, missingPaths));
      return args.some(v => v === true);
    }
    case 'not': {
      const v = evalExpr(expr.arg, ctx, missingPaths);
      return v === false;
    }
    default:
      throw new Error(`Unsupported expression op: ${expr.op}`);
  }
}

function evalDistinction(distinction, ctx) {
  if (!distinction || distinction.schema !== DISTINCTION_SCHEMA) {
    throw new Error('Invalid distinction descriptor');
  }
  switch (distinction.op) {
    case 'path': {
      const val = getAtPath(ctx, distinction.path);
      const missing = val === undefined ? [distinction.path] : [];
      return {
        value: val === undefined ? null : clone(val),
        missing_paths: missing,
        ok: missing.length === 0,
      };
    }
    case 'eq_paths': {
      const l = getAtPath(ctx, distinction.left_path);
      const r = getAtPath(ctx, distinction.right_path);
      const missing = [];
      if (l === undefined) missing.push(distinction.left_path);
      if (r === undefined) missing.push(distinction.right_path);
      if (missing.length > 0) {
        return { value: null, missing_paths: missing, ok: false };
      }
      return { value: equal(l, r), missing_paths: [], ok: true };
    }
    case 'pred': {
      const missing = [];
      const val = evalExpr(distinction.expr, ctx, missing);
      return {
        value: missing.length > 0 ? null : val,
        missing_paths: [...new Set(missing)],
        ok: missing.length === 0,
      };
    }
    case 'tensor': {
      const leftRes = evalDistinction(distinction.left, ctx);
      const rightRes = evalDistinction(distinction.right, ctx);
      const missing = [...new Set([...leftRes.missing_paths, ...rightRes.missing_paths])];
      return {
        value: [leftRes.value, rightRes.value],
        missing_paths: missing,
        ok: missing.length === 0,
      };
    }
    default:
      throw new Error(`Unsupported distinction op: ${distinction.op}`);
  }
}

/**
 * Checks whether fineD refines coarseD (coarseD <= fineD) over domainSample.
 * Law: D <= D' iff:
 * 1. Partition refinement: for all x, y in S, D'(x) == D'(y) => D(x) == D(y).
 * 2. Explicit recovery (when recoveryFn is provided): for all x in S, D(x) == recoveryFn(D'(x)).
 */
function testRefinement(coarseD, fineD, domainSample, recoveryFn = null) {
  const evaluations = domainSample.map((sample, idx) => {
    const c = evalDistinction(coarseD, sample);
    const f = evalDistinction(fineD, sample);
    return {
      index: idx,
      coarse: c.value,
      coarse_hash: hash({ v: c.value, m: c.missing_paths }),
      fine: f.value,
      fine_hash: hash({ v: f.value, m: f.missing_paths }),
    };
  });

  const partitionViolations = [];
  for (let i = 0; i < evaluations.length; i += 1) {
    for (let j = i + 1; j < evaluations.length; j += 1) {
      if (
        evaluations[i].fine_hash === evaluations[j].fine_hash &&
        evaluations[i].coarse_hash !== evaluations[j].coarse_hash
      ) {
        partitionViolations.push({
          pair: [i, j],
          fine_value: evaluations[i].fine,
          coarse_values: [evaluations[i].coarse, evaluations[j].coarse],
        });
      }
    }
  }

  const recoveryViolations = [];
  if (typeof recoveryFn === 'function') {
    for (const item of evaluations) {
      const recovered = recoveryFn(item.fine);
      if (!equal(recovered, item.coarse)) {
        recoveryViolations.push({
          index: item.index,
          expected_coarse: item.coarse,
          recovered,
          fine_value: item.fine,
        });
      }
    }
  }

  return {
    holds: partitionViolations.length === 0 && recoveryViolations.length === 0,
    partition_refines: partitionViolations.length === 0,
    recovery_holds: recoveryViolations.length === 0,
    partition_violations: partitionViolations,
    recovery_violations: recoveryViolations,
  };
}

function testDistinctionLaws(d1, d2, d3, domainSample) {
  const d12 = tensor(d1, d2);
  const d11 = tensor(d1, d1);
  const d12_3 = tensor(tensor(d1, d2), d3);
  const d1_23 = tensor(d1, tensor(d2, d3));

  // Law 1: D1 <= D1 ⊗ D2 and D2 <= D1 ⊗ D2
  const refinesLeft = testRefinement(d1, d12, domainSample, pair => pair[0]);
  const refinesRight = testRefinement(d2, d12, domainSample, pair => pair[1]);

  // Law 2: Idempotence up to recovery: D1 <= D1 ⊗ D1 and D1 ⊗ D1 <= D1
  const idemForward = testRefinement(d1, d11, domainSample, pair => pair[0]);
  const idemBackward = testRefinement(d11, d1, domainSample, val => [val, val]);

  // Law 3: Associativity up to recovery: (D1 ⊗ D2) ⊗ D3 <-> D1 ⊗ (D2 ⊗ D3)
  const assocForward = testRefinement(
    d12_3,
    d1_23,
    domainSample,
    ([a, [b, c]]) => [[a, b], c]
  );
  const assocBackward = testRefinement(
    d1_23,
    d12_3,
    domainSample,
    ([[a, b], c]) => [a, [b, c]]
  );

  // Law 4 (Counterexample / Negative test): D2 is NOT refined by D1 when D1 ignores D2's feature
  const negativeNonRefinement = testRefinement(d2, d1, domainSample);

  return {
    left_projection_refinement: refinesLeft.holds,
    right_projection_refinement: refinesRight.holds,
    idempotence_up_to_recovery: idemForward.holds && idemBackward.holds,
    associativity_up_to_recovery: assocForward.holds && assocBackward.holds,
    non_refinement_counterexample_detected: !negativeNonRefinement.holds,
    counterexample_witness: negativeNonRefinement.partition_violations[0] || null,
  };
}

// ============================================================================
// B. PROCEDURES AND COMPOSITION (p ; q, id, READ vs EXTERNAL OBSERVE)
// ============================================================================

function idProc(name = 'id') {
  return { schema: PROCEDURE_SCHEMA, op: 'id', name };
}

function readMemProc(key, targetField = key) {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'read_mem',
    name: `read_mem(${key})`,
    key,
    target_field: targetField,
  };
}

function writeMemProc(key, valuePath, options = {}) {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'write_mem',
    name: `write_mem(${key}<-${valuePath})`,
    key,
    value_path: valuePath,
    skip_if_undefined: options.skip_if_undefined !== false,
  };
}

function observeExternalProc({ sensor, querySpec, targetField, maxAgeMs = 5000 }) {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'observe_external',
    name: `observe_external(${sensor}->${targetField})`,
    sensor,
    query_spec: clone(querySpec),
    target_field: targetField,
    max_age_ms: maxAgeMs,
  };
}

function projectDistinctionProc(distinction, targetField = 'projection') {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'project_distinction',
    name: `project(${distinction.name})`,
    distinction: clone(distinction),
    target_field: targetField,
  };
}

function emitEffectProc(decisionKind, payloadSpec = {}) {
  if (!['ADMIT', 'HOLD'].includes(decisionKind)) {
    throw new Error('emitEffectProc decisionKind must be ADMIT or HOLD');
  }
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'emit_effect',
    name: `emit_effect(${decisionKind})`,
    decision_kind: decisionKind,
    payload_spec: clone(payloadSpec),
  };
}

function branchGuardProc({ name, distinction, passExpr, onPass, onFail }) {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'branch_guard',
    name: name || `guard(${distinction.name})`,
    distinction: clone(distinction),
    pass_expr: clone(passExpr),
    on_pass: clone(onPass),
    on_fail: clone(onFail),
  };
}

function seq(firstProc, secondProc) {
  if (firstProc?.schema !== PROCEDURE_SCHEMA || secondProc?.schema !== PROCEDURE_SCHEMA) {
    throw new Error('seq requires two procedure.v1 AST nodes');
  }
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'seq',
    name: `(${firstProc.name};${secondProc.name})`,
    first: clone(firstProc),
    second: clone(secondProc),
  };
}

// Reflective AST primitives for revision procedures r in the SAME algebra:
function inspectCollisionProc(name = 'inspect_collision') {
  return { schema: PROCEDURE_SCHEMA, op: 'inspect_collision', name };
}

function discoverDistinctionProc({
  name = 'discover_distinction',
  searchScope = ['present', 'obs'],
  verifyScope = 'colliding_pair_only',
} = {}) {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'discover_distinction',
    name,
    search_scope: clone(searchScope),
    verify_scope: verifyScope,
  };
}

function rewriteGuardTensorProc(name = 'rewrite_guard_tensor') {
  return { schema: PROCEDURE_SCHEMA, op: 'rewrite_guard_tensor', name };
}

function verifyCandidateReplayProc({
  name = 'verify_candidate_replay',
  verifyScope = 'colliding_pair_only',
} = {}) {
  return {
    schema: PROCEDURE_SCHEMA,
    op: 'verify_candidate_replay',
    name,
    verify_scope: verifyScope,
  };
}

function rewriteRevisionScopeProc(name = 'rewrite_revision_scope') {
  return { schema: PROCEDURE_SCHEMA, op: 'rewrite_revision_scope', name };
}

// ============================================================================
// C. REFLECTION (quote, programHash, compileProcedure, run, receipts)
// ============================================================================

function quote(procAst) {
  if (!procAst || procAst.schema !== PROCEDURE_SCHEMA) {
    throw new Error('quote expects a valid agent_os.algebra.procedure.v1 AST');
  }
  const canonicalAst = clone(procAst);
  return {
    kind: 'agent_os.algebra.quoted_procedure.v1',
    interpreter_version: INTERPRETER_VERSION,
    program_sha256: hash(canonicalAst),
    ast: canonicalAst,
  };
}

function unquote(quoted) {
  if (!quoted || quoted.kind !== 'agent_os.algebra.quoted_procedure.v1') {
    throw new Error('unquote expects a valid quoted_procedure.v1 object');
  }
  if (hash(quoted.ast) !== quoted.program_sha256) {
    throw new Error('Quoted program hash mismatch (tampered AST)');
  }
  return clone(quoted.ast);
}

function createCostLedger() {
  return {
    generation_calls: 0,
    retrieval_calls: 0,
    probe_calls: 0,
    validation_runs: 0,
    step_evaluations: 0,
    internal_mem_reads: 0,
    internal_mem_writes: 0,
    init_ms: 0,
    eval_ms: 0,
  };
}

function memPairsToObject(memArray) {
  if (!Array.isArray(memArray)) return clone(memArray || {});
  const out = {};
  for (const entry of memArray) {
    if (Array.isArray(entry) && typeof entry[0] === 'string') {
      out[entry[0]] = clone(entry[1]?.value);
    }
  }
  return out;
}

function createInitialState(initialMem = {}, initialObservations = {}) {
  const t0 = performance.now();
  let coreState = init();
  const memSource = Array.isArray(initialMem) ? memPairsToObject(initialMem) : initialMem;
  for (const [k, v] of Object.entries(memSource || {})) {
    if (v !== undefined) {
      coreState = step(coreState, cell(K.WRITE, { key: k, value: clone(v) }));
    }
  }
  return {
    core: coreState,
    mem: memPairsToObject(coreState.mem),
    observations: clone(initialObservations),
    init_ms: Number((performance.now() - t0).toFixed(4)),
  };
}

function resolveSpecObject(spec, ctx) {
  if (!spec || typeof spec !== 'object') return spec;
  const resolved = {};
  for (const [k, v] of Object.entries(spec)) {
    if (typeof v === 'string' && v.startsWith('$path:')) {
      resolved[k] = getAtPath(ctx, v.slice('$path:'.length));
    } else {
      resolved[k] = clone(v);
    }
  }
  return resolved;
}

function findGuardNode(ast) {
  if (!ast || typeof ast !== 'object') return null;
  if (ast.op === 'branch_guard') return ast;
  if (ast.op === 'seq') {
    return findGuardNode(ast.first) || findGuardNode(ast.second);
  }
  return null;
}

function buildEpisodeContext(episode, state) {
  return {
    input: clone(episode.input || {}),
    present: clone(episode.input?.data?.present || {}),
    approval_time: clone(episode.input?.data?.approval_time || {}),
    cognitive_frame: clone(episode.input?.data?.cognitive_frame || {}),
    grant_time: clone(episode.input?.data?.grant_time || {}),
    mem: clone({ ...(state?.mem || {}), ...(episode.mem || {}) }),
    obs: clone({ ...(state?.observations || {}), ...(episode.observations || {}) }),
  };
}

/**
 * Synthesizes candidate distinctions over colliding episodes within the allowed searchScope.
 * Directly generalizes src/boundary_discovery.js and src/paired_boundary.js.
 */
function generateCandidateDistinctions(collidingPair, searchScope) {
  const [epA, epB] = collidingPair;
  const ctxA = epA.context;
  const ctxB = epB.context;
  const leavesA = collectLeafPaths(ctxA, searchScope);
  const candidates = [];
  const seen = new Set();

  // 1. Single-path value distinctions (e.g. cognitive_frame.inquiry_stance or present.*)
  for (const leaf of leavesA) {
    const valB = getAtPath(ctxB, leaf.path);
    if (valB !== undefined && !equal(leaf.value, valB)) {
      const topScope = leaf.path.split('.')[0];
      let d;
      if (topScope === 'cognitive_frame' || topScope === 'approval_time' || topScope === 'grant_time') {
        const memKey = `retained_${leaf.path.replace(/\./g, '_')}`;
        d = pathDistinction(
          `mem.${memKey}`,
          `mem.${memKey}`,
          {
            requires_mem: {
              key: memKey,
              from_input_path: `input.data.${leaf.path}`,
            },
          }
        );
      } else {
        d = pathDistinction(leaf.path, leaf.path);
      }
      const key = JSON.stringify({ d, passVal: leaf.value });
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({
          distinction: d,
          expected_pass_value: epA.expected === 'ADMIT' ? leaf.value : valB,
          source_scope: topScope,
        });
      }
    }
  }

  // 2. Cross-path relational distinctions (e.g. obs.current_file_sha256 == approval_time.file_sha256)
  const obsLeavesA = collectLeafPaths(ctxA, ['obs']);
  const refScopes = searchScope.filter(s => ['approval_time', 'grant_time', 'mem', 'present'].includes(s));
  const refLeavesA = collectLeafPaths(ctxA, refScopes);

  for (const obsLeaf of obsLeavesA) {
    for (const refLeaf of refLeavesA) {
      if (obsLeaf.path === refLeaf.path) continue;
      const eqInA = equal(obsLeaf.value, refLeaf.value);
      const obsValB = getAtPath(ctxB, obsLeaf.path);
      const refValB = getAtPath(ctxB, refLeaf.path);
      if (obsValB === undefined || refValB === undefined) continue;
      const eqInB = equal(obsValB, refValB);
      if (eqInA !== eqInB) {
        const topScope = refLeaf.path.split('.')[0];
        let rightPath = refLeaf.path;
        let requiresMem = null;
        if (topScope === 'approval_time' || topScope === 'grant_time') {
          const memKey = `baseline_${refLeaf.path.replace(/\./g, '_')}`;
          rightPath = `mem.${memKey}`;
          requiresMem = {
            key: memKey,
            from_input_path: `input.data.${refLeaf.path}`,
          };
        }
        const d = eqPathsDistinction(
          `eq(${obsLeaf.path},${rightPath})`,
          obsLeaf.path,
          rightPath,
          { requires_mem: requiresMem }
        );
        const key = JSON.stringify(d);
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({
            distinction: d,
            expected_pass_value: epA.expected === 'ADMIT' ? eqInA : eqInB,
            source_scope: topScope,
          });
        }
      }
    }
  }

  return candidates;
}

function buildRevisedTargetAst(baseAst, candidateSpec) {
  const d = candidateSpec.distinction;
  const expectedVal = candidateSpec.expected_pass_value;

  function rewriteNode(node) {
    if (node.op === 'branch_guard') {
      const refinedD = tensor(node.distinction, d);
      const refinedPassExpr = {
        op: 'and',
        args: [
          // Preserve original pass expression on left component proj[0]
          remapProjectionPaths(node.pass_expr, 'working.projection.0'),
          {
            op: 'eq',
            left: { op: 'path', path: 'working.projection.1' },
            right: { op: 'literal', value: expectedVal },
          },
        ],
      };
      return branchGuardProc({
        name: `${node.name}⊗${d.name}`,
        distinction: refinedD,
        passExpr: refinedPassExpr,
        onPass: node.on_pass,
        onFail: node.on_fail,
      });
    }
    if (node.op === 'seq') {
      return seq(rewriteNode(node.first), rewriteNode(node.second));
    }
    return clone(node);
  }

  let rewritten = rewriteNode(baseAst);
  if (d.requires_mem && d.requires_mem.key && d.requires_mem.from_input_path) {
    const rememberStep = writeMemProc(d.requires_mem.key, d.requires_mem.from_input_path, {
      skip_if_undefined: true,
    });
    rewritten = seq(rememberStep, rewritten);
  }
  return rewritten;
}

function remapProjectionPaths(expr, newPrefix) {
  if (!expr || typeof expr !== 'object') return expr;
  const copy = clone(expr);
  if (copy.op === 'path' && copy.path === 'working.projection') {
    copy.path = newPrefix;
  } else if (copy.op === 'path' && copy.path.startsWith('working.projection.')) {
    copy.path = `${newPrefix}.${copy.path.slice('working.projection.'.length)}`;
  }
  if (copy.left) copy.left = remapProjectionPaths(copy.left, newPrefix);
  if (copy.right) copy.right = remapProjectionPaths(copy.right, newPrefix);
  if (copy.arg) copy.arg = remapProjectionPaths(copy.arg, newPrefix);
  if (Array.isArray(copy.args)) {
    copy.args = copy.args.map(a => remapProjectionPaths(a, newPrefix));
  }
  return copy;
}

/**
 * Core algebraic interpreter. Executes a quoted procedure (or AST) and produces
 * a complete, tamper-evident decision receipt.
 */
function run(quotedOrAst, initialState, rawInput, adapter = {}) {
  const tStart = performance.now();
  const quotedProg =
    quotedOrAst?.kind === 'agent_os.algebra.quoted_procedure.v1'
      ? quotedOrAst
      : quote(quotedOrAst);
  const ast = unquote(quotedProg);

  const ledger = adapter.costLedger || createCostLedger();
  const normalizedInit =
    initialState && initialState.core
      ? initialState
      : createInitialState(initialState?.mem || {}, initialState?.observations || {});

  let coreState = normalizedInit.core;
  let memObj = clone(normalizedInit.mem || memPairsToObject(coreState.mem));
  let obsObj = clone(normalizedInit.observations || {});

  const preState = {
    head: coreState.head,
    core_snapshot_sha256: hash(snapshot(coreState)),
    mem: clone(memObj),
    observations: clone(obsObj),
    effects_count: coreState.effects.length,
    halted: coreState.halted,
  };

  const working = {};
  const observationsRequested = [];
  const effectsProposed = [];
  const trace = [];
  let selectedOp = null;
  let lastOutcome = 'id_noop';

  function evalNode(node) {
    ledger.step_evaluations += 1;
    const ctx = {
      input: rawInput,
      present: rawInput?.data?.present || {},
      approval_time: rawInput?.data?.approval_time || {},
      cognitive_frame: rawInput?.data?.cognitive_frame || {},
      grant_time: rawInput?.data?.grant_time || {},
      mem: memObj,
      obs: obsObj,
      working,
    };

    switch (node.op) {
      case 'id': {
        trace.push({ op: 'id', name: node.name, status: 'completed' });
        return { status: 'completed', outcome: lastOutcome };
      }

      case 'read_mem': {
        ledger.internal_mem_reads += 1;
        const readEv = cell(K.READ, { key: node.key });
        coreState = step(coreState, readEv);
        const blob = readMem(coreState, node.key);
        const val = blob ? blob.value : undefined;
        working[node.target_field] = val === undefined ? null : clone(val);
        trace.push({ op: 'read_mem', key: node.key, found: val !== undefined, status: 'completed' });
        return { status: 'completed', outcome: 'mem_read' };
      }

      case 'write_mem': {
        const val = getAtPath(ctx, node.value_path);
        if (val === undefined && node.skip_if_undefined) {
          trace.push({ op: 'write_mem', key: node.key, skipped: true, status: 'completed' });
          return { status: 'completed', outcome: 'mem_write_skipped' };
        }
        ledger.internal_mem_writes += 1;
        const writeEv = cell(K.WRITE, { key: node.key, value: clone(val) });
        coreState = step(coreState, writeEv);
        memObj = memPairsToObject(coreState.mem);
        working[node.key] = clone(val);
        trace.push({ op: 'write_mem', key: node.key, value: clone(val), status: 'completed' });
        return { status: 'completed', outcome: 'mem_written' };
      }

      case 'observe_external': {
        const resolvedQuery = resolveSpecObject(node.query_spec, {
          input: rawInput,
          mem: memObj,
          obs: obsObj,
          working,
        });
        const reqRecord = {
          sensor: node.sensor,
          query: resolvedQuery,
          target_field: node.target_field,
          max_age_ms: node.max_age_ms,
        };
        if (node.sensor === 'digup_index') {
          ledger.retrieval_calls += 1;
        } else {
          ledger.probe_calls += 1;
        }

        let obsResult;
        if (typeof adapter.observeExternal === 'function') {
          obsResult = adapter.observeExternal(reqRecord, { mem: memObj, observations: obsObj }, rawInput);
        } else if (obsObj[node.target_field] !== undefined) {
          obsResult = {
            status: 'ok',
            value: obsObj[node.target_field],
            age_ms: 0,
          };
        } else {
          obsResult = { status: 'missing', value: null, age_ms: null };
        }

        observationsRequested.push({
          ...reqRecord,
          response_status: obsResult.status,
          age_ms: obsResult.age_ms ?? null,
          returned_value: clone(obsResult.value ?? null),
        });

        if (obsResult.status === 'missing') {
          trace.push({ op: 'observe_external', sensor: node.sensor, status: 'suspended_missing_evidence', reason: 'missing_observation' });
          selectedOp = 'HOLD';
          return { status: 'suspended_missing_evidence', outcome: 'missing_observation' };
        }
        if (obsResult.status === 'unavailable') {
          trace.push({ op: 'observe_external', sensor: node.sensor, status: 'suspended_missing_evidence', reason: 'sensor_unavailable' });
          selectedOp = 'HOLD';
          return { status: 'suspended_missing_evidence', outcome: 'sensor_unavailable' };
        }
        if (
          obsResult.status === 'stale' ||
          (typeof obsResult.age_ms === 'number' && obsResult.age_ms > node.max_age_ms)
        ) {
          trace.push({ op: 'observe_external', sensor: node.sensor, status: 'suspended_missing_evidence', reason: 'stale_observation' });
          selectedOp = 'HOLD';
          return { status: 'suspended_missing_evidence', outcome: 'stale_observation' };
        }

        obsObj[node.target_field] = clone(obsResult.value);
        working[node.target_field] = clone(obsResult.value);
        trace.push({ op: 'observe_external', sensor: node.sensor, target: node.target_field, status: 'completed' });
        return { status: 'completed', outcome: 'observation_recorded' };
      }

      case 'project_distinction': {
        const res = evalDistinction(node.distinction, ctx);
        if (!res.ok) {
          trace.push({
            op: 'project_distinction',
            distinction: node.distinction.name,
            missing_paths: res.missing_paths,
            status: 'suspended_missing_evidence',
          });
          selectedOp = 'HOLD';
          return {
            status: 'suspended_missing_evidence',
            outcome: `missing_distinction_evidence:${res.missing_paths.join(',')}`,
          };
        }
        working[node.target_field] = res.value;
        trace.push({
          op: 'project_distinction',
          distinction: node.distinction.name,
          value: res.value,
          status: 'completed',
        });
        return { status: 'completed', outcome: 'distinction_projected' };
      }

      case 'branch_guard': {
        const dRes = evalDistinction(node.distinction, ctx);
        if (!dRes.ok) {
          trace.push({
            op: 'branch_guard',
            distinction: node.distinction.name,
            missing_paths: dRes.missing_paths,
            status: 'suspended_missing_evidence',
          });
          selectedOp = 'HOLD';
          return {
            status: 'suspended_missing_evidence',
            outcome: `missing_guard_evidence:${dRes.missing_paths.join(',')}`,
          };
        }
        working.projection = dRes.value;
        const guardCtx = { ...ctx, working: { ...working, projection: dRes.value } };
        const missingExprPaths = [];
        const passed = evalExpr(node.pass_expr, guardCtx, missingExprPaths) === true;
        trace.push({
          op: 'branch_guard',
          distinction: node.distinction.name,
          projection: dRes.value,
          passed,
          status: 'completed',
        });
        return passed ? evalNode(node.on_pass) : evalNode(node.on_fail);
      }

      case 'emit_effect': {
        const resolvedPayload = resolveSpecObject(node.payload_spec, ctx);
        selectedOp = node.decision_kind;
        if (node.decision_kind === 'ADMIT') {
          const admitEvent = cell(K.ADMIT, resolvedPayload);
          // Route through existing effect_proxy.js admission check when candidate context is provided,
          // and always record through src/core.js step().
          let proxyVerdict = { ok: true, code: 'OK', reason: 'admitted_by_guard' };
          if (adapter.effectProxyContext) {
            proxyVerdict = validateAdmission(
              adapter.effectProxyContext.state,
              adapter.effectProxyContext.candidate,
              adapter.effectProxyContext.opts
            );
          }
          if (!proxyVerdict.ok) {
            effectsProposed.push({ decision: 'HOLD', blocked_by_proxy: proxyVerdict, payload: resolvedPayload });
            trace.push({ op: 'emit_effect', decision: 'HOLD', reason: proxyVerdict.code, status: 'held' });
            selectedOp = 'HOLD';
            return { status: 'held', outcome: `proxy_blocked:${proxyVerdict.code}` };
          }
          coreState = step(coreState, admitEvent);
          effectsProposed.push({ decision: 'ADMIT', payload: resolvedPayload });
          trace.push({ op: 'emit_effect', decision: 'ADMIT', payload: resolvedPayload, status: 'completed' });
          return { status: 'completed', outcome: 'ADMIT' };
        }
        // HOLD decision: do not append to coreState.effects
        effectsProposed.push({ decision: 'HOLD', payload: resolvedPayload });
        trace.push({ op: 'emit_effect', decision: 'HOLD', payload: resolvedPayload, status: 'held' });
        return { status: 'held', outcome: 'HOLD' };
      }

      case 'seq': {
        const firstRes = evalNode(node.first);
        if (firstRes.status !== 'completed') {
          // Short-circuit: downstream procedure does not run when upstream holds or suspends
          return firstRes;
        }
        lastOutcome = firstRes.outcome;
        return evalNode(node.second);
      }

      // ---- Reflective Revision Nodes (operating on quoted procedures) ----
      case 'inspect_collision': {
        const targetQuoted = rawInput?.data?.target_program;
        const episodes = rawInput?.data?.episodes || [];
        if (!targetQuoted || episodes.length < 2) {
          return { status: 'suspended_missing_evidence', outcome: 'missing_target_or_episodes' };
        }
        const targetAst = unquote(targetQuoted);
        const guardNode = findGuardNode(targetAst);
        if (!guardNode) {
          return { status: 'error', outcome: 'target_has_no_branch_guard' };
        }

        const evaluatedEpisodes = episodes.map(ep => {
          const epState = createInitialState(ep.mem || {}, ep.observations || {});
          const epReceipt = run(targetQuoted, epState, ep.input, {
            ...adapter,
            costLedger: ledger,
          });
          ledger.validation_runs += 1;
          const epCtx = buildEpisodeContext(ep, epReceipt.post_state);
          const proj = evalDistinction(guardNode.distinction, epCtx);
          return {
            id: ep.id,
            expected: ep.expected,
            actual: epReceipt.selected_op,
            projection_hash: hash({ v: proj.value, m: proj.missing_paths }),
            projection_value: proj.value,
            context: epCtx,
            raw_episode: ep,
          };
        });

        let collidingPair = null;
        for (let i = 0; i < evaluatedEpisodes.length; i += 1) {
          for (let j = i + 1; j < evaluatedEpisodes.length; j += 1) {
            const a = evaluatedEpisodes[i];
            const b = evaluatedEpisodes[j];
            if (a.projection_hash === b.projection_hash && a.expected !== b.expected) {
              collidingPair = [a, b];
              break;
            }
          }
          if (collidingPair) break;
        }

        if (!collidingPair) {
          trace.push({ op: 'inspect_collision', collision_found: false, status: 'held' });
          selectedOp = 'HOLD';
          return { status: 'held', outcome: 'no_projection_collision' };
        }

        working.colliding_pair = collidingPair;
        working.target_ast = targetAst;
        trace.push({
          op: 'inspect_collision',
          collision_found: true,
          pair_ids: [collidingPair[0].id, collidingPair[1].id],
          shared_projection: collidingPair[0].projection_value,
          status: 'completed',
        });
        return { status: 'completed', outcome: 'collision_detected' };
      }

      case 'discover_distinction': {
        const pair = working.colliding_pair;
        if (!pair) {
          return { status: 'suspended_missing_evidence', outcome: 'missing_colliding_pair' };
        }
        const candidates = generateCandidateDistinctions(pair, node.search_scope);
        if (candidates.length === 0) {
          trace.push({
            op: 'discover_distinction',
            search_scope: node.search_scope,
            candidate_count: 0,
            status: 'held',
          });
          selectedOp = 'HOLD';
          return { status: 'held', outcome: 'collision_unresolved_in_scope' };
        }

        let selectedCandidate = null;
        const retainedEpisodes =
          node.verify_scope === 'all_retained_episodes'
            ? rawInput?.data?.retained_episodes || rawInput?.data?.episodes || []
            : pair.map(p => p.raw_episode);

        for (const cand of candidates) {
          const trialAst = buildRevisedTargetAst(working.target_ast, cand);
          const trialQuoted = quote(trialAst);
          let allMatch = true;
          for (const ep of retainedEpisodes) {
            const epState = createInitialState(ep.mem || {}, ep.observations || {});
            const epRes = run(trialQuoted, epState, ep.input, {
              ...adapter,
              costLedger: ledger,
            });
            ledger.validation_runs += 1;
            if (epRes.selected_op !== ep.expected) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            selectedCandidate = cand;
            break;
          }
        }

        if (!selectedCandidate) {
          trace.push({
            op: 'discover_distinction',
            search_scope: node.search_scope,
            verify_scope: node.verify_scope,
            candidate_count: candidates.length,
            status: 'held',
          });
          selectedOp = 'HOLD';
          return { status: 'held', outcome: 'no_non_regressing_distinction_in_scope' };
        }

        working.selected_candidate = selectedCandidate;
        trace.push({
          op: 'discover_distinction',
          selected_distinction: selectedCandidate.distinction.name,
          source_scope: selectedCandidate.source_scope,
          verify_scope: node.verify_scope,
          status: 'completed',
        });
        return { status: 'completed', outcome: 'distinction_discovered' };
      }

      case 'rewrite_guard_tensor': {
        if (!working.target_ast || !working.selected_candidate) {
          return { status: 'suspended_missing_evidence', outcome: 'missing_rewrite_inputs' };
        }
        const revisedAst = buildRevisedTargetAst(working.target_ast, working.selected_candidate);
        const revisedQuoted = quote(revisedAst);
        working.candidate_program = revisedQuoted;
        trace.push({
          op: 'rewrite_guard_tensor',
          new_program_sha256: revisedQuoted.program_sha256,
          status: 'completed',
        });
        return { status: 'completed', outcome: 'program_rewritten' };
      }

      case 'verify_candidate_replay': {
        const candidateQuoted = working.candidate_program;
        if (!candidateQuoted) {
          return { status: 'suspended_missing_evidence', outcome: 'missing_candidate_program' };
        }
        const replaySet =
          node.verify_scope === 'all_retained_episodes'
            ? rawInput?.data?.retained_episodes || rawInput?.data?.episodes || []
            : (working.colliding_pair || []).map(p => p.raw_episode);

        const replayReceipts = [];
        for (const ep of replaySet) {
          const epState = createInitialState(ep.mem || {}, ep.observations || {});
          const epRes = run(candidateQuoted, epState, ep.input, {
            ...adapter,
            costLedger: ledger,
          });
          ledger.validation_runs += 1;
          replayReceipts.push({
            id: ep.id,
            expected: ep.expected,
            actual: epRes.selected_op,
            passed: epRes.selected_op === ep.expected,
          });
        }

        const allPassed = replayReceipts.length > 0 && replayReceipts.every(r => r.passed);
        working.verification_report = {
          verify_scope: node.verify_scope,
          total: replayReceipts.length,
          passed: replayReceipts.filter(r => r.passed).length,
          episodes: replayReceipts,
          all_passed: allPassed,
        };

        if (!allPassed) {
          selectedOp = 'HOLD';
          trace.push({
            op: 'verify_candidate_replay',
            verify_scope: node.verify_scope,
            all_passed: false,
            status: 'held',
          });
          return { status: 'held', outcome: 'candidate_failed_replay_verification' };
        }

        selectedOp = 'ADMIT';
        coreState = step(
          coreState,
          cell(K.ADMIT, {
            revised_program_sha256: candidateQuoted.program_sha256,
            distinction_added: working.selected_candidate?.distinction?.name || null,
          })
        );
        trace.push({
          op: 'verify_candidate_replay',
          verify_scope: node.verify_scope,
          all_passed: true,
          status: 'completed',
        });
        return { status: 'completed', outcome: 'ADMIT' };
      }

      case 'rewrite_revision_scope': {
        const targetRevQuoted = rawInput?.data?.target_revision_program;
        const detectorFailure = rawInput?.data?.detector_failure;
        if (!targetRevQuoted || !detectorFailure) {
          return { status: 'suspended_missing_evidence', outcome: 'missing_meta_revision_inputs' };
        }
        const revAst = unquote(targetRevQuoted);
        const additionalScopes = detectorFailure.unsearched_scopes || [
          'approval_time',
          'cognitive_frame',
          'grant_time',
        ];

        function upgradeRevNode(n) {
          if (n.op === 'discover_distinction') {
            const mergedScopes = [...new Set([...n.search_scope, ...additionalScopes])];
            return discoverDistinctionProc({
              name: `${n.name}⊗historical_scopes`,
              searchScope: mergedScopes,
              verifyScope: 'all_retained_episodes',
            });
          }
          if (n.op === 'verify_candidate_replay') {
            return verifyCandidateReplayProc({
              name: `${n.name}⊗full_replay`,
              verifyScope: 'all_retained_episodes',
            });
          }
          if (n.op === 'seq') {
            return seq(upgradeRevNode(n.first), upgradeRevNode(n.second));
          }
          return clone(n);
        }

        const upgradedAst = upgradeRevNode(revAst);
        const upgradedQuoted = quote(upgradedAst);
        working.candidate_program = upgradedQuoted;
        selectedOp = 'ADMIT';
        coreState = step(
          coreState,
          cell(K.ADMIT, {
            prior_revision_sha256: targetRevQuoted.program_sha256,
            revised_revision_sha256: upgradedQuoted.program_sha256,
            added_scopes: additionalScopes,
          })
        );
        trace.push({
          op: 'rewrite_revision_scope',
          prior_sha256: targetRevQuoted.program_sha256,
          upgraded_sha256: upgradedQuoted.program_sha256,
          status: 'completed',
        });
        return { status: 'completed', outcome: 'ADMIT' };
      }

      default:
        throw new Error(`Unsupported procedure AST op: ${node.op}`);
    }
  }

  const execRes = evalNode(ast);
  const evalMs = Number((performance.now() - tStart).toFixed(4));
  ledger.eval_ms = Number((ledger.eval_ms + evalMs).toFixed(4));

  const postState = {
    head: coreState.head,
    core_snapshot_sha256: hash(snapshot(coreState)),
    mem: clone(memObj),
    observations: clone(obsObj),
    effects_count: coreState.effects.length,
    halted: coreState.halted,
  };

  const receiptBody = {
    kind: 'agent_os.algebra.decision_receipt.v1',
    interpreter_version: INTERPRETER_VERSION,
    original_input: clone(rawInput),
    program_sha256: quotedProg.program_sha256,
    pre_state: preState,
    selected_op: selectedOp || (execRes.status === 'completed' ? 'COMPLETED' : 'HOLD'),
    observations_requested: observationsRequested,
    effects_proposed: effectsProposed,
    status: execRes.status,
    actual_outcome: execRes.outcome,
    post_state: postState,
    candidate_revision: working.candidate_program
      ? {
          program_sha256: working.candidate_program.program_sha256,
          distinction_added: working.selected_candidate?.distinction?.name || null,
          verification_report: working.verification_report || null,
        }
      : null,
    working: clone(working),
    trace,
    eval_ms: evalMs,
  };

  return {
    ...receiptBody,
    receipt_sha256: hash(receiptBody),
  };
}

function compileProcedure(quotedOrAst) {
  const quotedProg =
    quotedOrAst?.kind === 'agent_os.algebra.quoted_procedure.v1'
      ? quotedOrAst
      : quote(quotedOrAst);
  return function compiledProcedure(state, input, adapter) {
    return run(quotedProg, state, input, adapter);
  };
}

// ============================================================================
// D. EQUIVALENCE AND JUSTIFIED CHANGE (Observational vs Criterion vs Cost)
// ============================================================================

/**
 * Evaluates two procedures p1 and p2 across a declared domain of episodes S and
 * separates:
 * 1. observational_equivalence: identical selected_op, post_state.mem, post_state.effects, and observations_requested.
 * 2. criterion_conformance: whether each procedure matches expected outcomes on S (and on preserved vs collision subsets).
 * 3. measured_cost: full cost ledger for each procedure.
 */
function compareProcedures(p1QuotedOrAst, p2QuotedOrAst, episodes, adapterFactory = () => ({})) {
  const q1 =
    p1QuotedOrAst?.kind === 'agent_os.algebra.quoted_procedure.v1'
      ? p1QuotedOrAst
      : quote(p1QuotedOrAst);
  const q2 =
    p2QuotedOrAst?.kind === 'agent_os.algebra.quoted_procedure.v1'
      ? p2QuotedOrAst
      : quote(p2QuotedOrAst);

  const ledger1 = createCostLedger();
  const ledger2 = createCostLedger();
  const comparisons = [];

  for (const ep of episodes) {
    const s1 = createInitialState(ep.mem || {}, ep.observations || {});
    const s2 = createInitialState(ep.mem || {}, ep.observations || {});
    ledger1.init_ms = Number((ledger1.init_ms + s1.init_ms).toFixed(4));
    ledger2.init_ms = Number((ledger2.init_ms + s2.init_ms).toFixed(4));

    const r1 = run(q1, s1, ep.input, { ...adapterFactory(ep), costLedger: ledger1 });
    const r2 = run(q2, s2, ep.input, { ...adapterFactory(ep), costLedger: ledger2 });

    const sameOutcome = r1.selected_op === r2.selected_op && r1.actual_outcome === r2.actual_outcome;
    const sameMem = equal(r1.post_state.mem, r2.post_state.mem);
    const sameEffects = equal(
      r1.effects_proposed.map(e => ({ decision: e.decision, payload: e.payload })),
      r2.effects_proposed.map(e => ({ decision: e.decision, payload: e.payload }))
    );
    const sameObsRequests = equal(
      r1.observations_requested.map(o => ({ sensor: o.sensor, query: o.query })),
      r2.observations_requested.map(o => ({ sensor: o.sensor, query: o.query }))
    );

    comparisons.push({
      episode_id: ep.id,
      subset: ep.subset || 'general',
      expected: ep.expected || null,
      p1_op: r1.selected_op,
      p2_op: r2.selected_op,
      p1_matches_criterion: ep.expected ? r1.selected_op === ep.expected : null,
      p2_matches_criterion: ep.expected ? r2.selected_op === ep.expected : null,
      observationally_equivalent: sameOutcome && sameMem && sameEffects && sameObsRequests,
      same_outcome: sameOutcome,
      same_mem: sameMem,
      same_effects: sameEffects,
      same_obs_requests: sameObsRequests,
    });
  }

  const preservedEps = comparisons.filter(c => c.subset === 'preserved');
  const collisionEps = comparisons.filter(c => c.subset === 'collision');

  return {
    p1_sha256: q1.program_sha256,
    p2_sha256: q2.program_sha256,
    observational_equivalence: {
      holds_on_all: comparisons.every(c => c.observationally_equivalent),
      holds_on_preserved_subset: preservedEps.every(c => c.observationally_equivalent),
      diverges_on_collision_subset: collisionEps.some(c => !c.observationally_equivalent),
    },
    criterion_conformance: {
      p1_score: `${comparisons.filter(c => c.p1_matches_criterion).length}/${comparisons.length}`,
      p2_score: `${comparisons.filter(c => c.p2_matches_criterion).length}/${comparisons.length}`,
      p2_preserves_prior_cases: preservedEps.every(c => c.p2_matches_criterion),
      p2_resolves_collision_cases: collisionEps.every(c => c.p2_matches_criterion),
      justified_replacement:
        preservedEps.every(c => c.p2_matches_criterion) &&
        collisionEps.every(c => c.p2_matches_criterion) &&
        comparisons.filter(c => c.p2_matches_criterion).length >
          comparisons.filter(c => c.p1_matches_criterion).length,
    },
    measured_cost: {
      p1: ledger1,
      p2: ledger2,
    },
    episodes: comparisons,
  };
}

/**
 * Explicit Replay Consistency & Non-Regression Detector for Case C.
 * Does NOT pre-set E, drift, or M; instead evaluates the output of a revision procedure r
 * against the full retained episode corpus and charges every check to the cost ledger.
 */
function detectRevisionFailure(revReceipt, fullRetainedEpisodes, adapter = {}) {
  const ledger = adapter.costLedger || createCostLedger();
  const allScopes = ['present', 'obs', 'approval_time', 'cognitive_frame', 'grant_time'];

  if (revReceipt.status !== 'completed' || !revReceipt.working?.candidate_program) {
    const searchedScopes =
      revReceipt.trace.find(t => t.op === 'discover_distinction')?.search_scope || ['present', 'obs'];
    return {
      failed: true,
      failure_kind: revReceipt.actual_outcome || 'revision_abstained',
      regressed_episodes: [],
      unsearched_scopes: allScopes.filter(s => !searchedScopes.includes(s)),
      validation_runs_charged: ledger.validation_runs,
    };
  }

  const candidateQuoted = revReceipt.working.candidate_program;
  const regressed = [];
  for (const ep of fullRetainedEpisodes) {
    const s = createInitialState(ep.mem || {}, ep.observations || {});
    const res = run(candidateQuoted, s, ep.input, { ...adapter, costLedger: ledger });
    ledger.validation_runs += 1;
    if (res.selected_op !== ep.expected) {
      regressed.push({
        episode_id: ep.id,
        expected: ep.expected,
        actual: res.selected_op,
      });
    }
  }

  const searchedScopes =
    revReceipt.trace.find(t => t.op === 'discover_distinction')?.search_scope || ['present', 'obs'];

  return {
    failed: regressed.length > 0,
    failure_kind: regressed.length > 0 ? 'replay_regression_on_retained_episodes' : null,
    regressed_episodes: regressed,
    unsearched_scopes: allScopes.filter(s => !searchedScopes.includes(s)),
    validation_runs_charged: ledger.validation_runs,
  };
}

module.exports = {
  INTERPRETER_VERSION,
  DISTINCTION_SCHEMA,
  PROCEDURE_SCHEMA,
  pathDistinction,
  eqPathsDistinction,
  predDistinction,
  tensor,
  evalExpr,
  evalDistinction,
  testRefinement,
  testDistinctionLaws,
  idProc,
  readMemProc,
  writeMemProc,
  observeExternalProc,
  projectDistinctionProc,
  emitEffectProc,
  branchGuardProc,
  seq,
  inspectCollisionProc,
  discoverDistinctionProc,
  rewriteGuardTensorProc,
  verifyCandidateReplayProc,
  rewriteRevisionScopeProc,
  quote,
  unquote,
  run,
  compileProcedure,
  createCostLedger,
  createInitialState,
  compareProcedures,
  detectRevisionFailure,
};
