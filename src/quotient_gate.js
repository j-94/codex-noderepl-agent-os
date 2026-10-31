'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual: equal } = require('node:util');

const defaultRule = path.resolve(__dirname, '../data/release_boundary.json');
const defaultCheckRule = path.resolve(__dirname, '../data/check_cache_boundary.json');
const boundaryRegistry = path.resolve(__dirname, '../data/active_discovered_boundaries.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function at(value, key) {
  if (typeof key !== 'string') throw new Error('Invalid path');
  return key === '' ? value : key.split('.').reduce((part, name) =>
    part !== null && typeof part === 'object' && Object.hasOwn(part, name) ? part[name] : null, value);
}

function expression(node, trace, item = null, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 64) throw new Error('Invalid boundary expression');
  const run = child => expression(child, trace, item, depth + 1);
  switch (node.op) {
    case 'literal':
      if (!Object.hasOwn(node, 'value')) throw new Error('Missing literal value');
      return node.value;
    case 'path':
      return node.path === '$' ? item : typeof node.path === 'string' && node.path.startsWith('$.')
        ? at(item, node.path.slice(2)) : at(trace, node.path);
    case 'eq': return equal(run(node.left), run(node.right));
    case 'and':
      if (!Array.isArray(node.args)) throw new Error('Invalid and arguments');
      return node.args.map(run).every(value => value === true);
    case 'all': {
      const items = run(node.items);
      return Array.isArray(items) && items.map(value =>
        expression(node.predicate, trace, value, depth + 1)).every(value => value === true);
    }
    case 'lookup': {
      const keys = run(node.keys), records = run(node.records);
      if (!Array.isArray(keys) || !Array.isArray(records) ||
          typeof node.key !== 'string' || typeof node.project !== 'string') return null;
      return keys.map(key => {
        const matches = records.filter(record => equal(at(record, node.key), key));
        return matches.length === 1 ? at(matches[0], node.project) : null;
      });
    }
    case 'contains_line': {
      const value = run(node.value);
      return typeof value === 'string' && typeof node.line === 'string' &&
        node.line.length > 0 && node.line.length <= 200 && !/[\r\n]/.test(node.line) &&
        value.split(/\r?\n/).some(line => line.trim() === node.line);
    }
    default: throw new Error(`Unknown boundary operation: ${node.op}`);
  }
}

function readJson(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > 1048576) throw new Error('Expected a bounded regular JSON file');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function child(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Invalid candidate path');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep) || !fs.realpathSync(resolved).startsWith(root + path.sep)) {
    throw new Error('Candidate path escapes run directory');
  }
  return resolved;
}

function currentInputsMatch(inputs) {
  return inputs.every(input => {
    if (!input || typeof input.path !== 'string' || !path.isAbsolute(input.path) ||
        !/^[a-f0-9]{64}$/.test(input.sha256)) return false;
    try {
      return fs.lstatSync(input.path).isFile() && sha256(fs.readFileSync(input.path)) === input.sha256;
    } catch {
      return false;
    }
  });
}

function registeredCheckRule(trace) {
  if (!fs.existsSync(boundaryRegistry)) return { bytes: fs.readFileSync(defaultCheckRule), scope_matches: true };
  const registry = readJson(boundaryRegistry);
  if (registry?.kind !== 'agent_os.active_boundaries.v1' || !Array.isArray(registry.entries)) {
    throw new Error('Invalid active boundary registry');
  }
  const matches = registry.entries.filter(entry =>
    equal(entry.command, trace.check.command) && entry.cwd === trace.check.cwd);
  if (matches.length > 1) throw new Error('Ambiguous active boundary');
  if (!matches.length) return { bytes: fs.readFileSync(defaultCheckRule), scope_matches: true };
  const entry = matches[0];
  if (typeof entry.rule_path !== 'string' || !path.isAbsolute(entry.rule_path) ||
      !/^[a-f0-9]{64}$/.test(entry.rule_sha256) || !Array.isArray(entry.static_inputs) ||
      !entry.static_inputs.length || entry.static_inputs.some(input =>
        typeof input.path !== 'string' || !path.isAbsolute(input.path) ||
        !/^[a-f0-9]{64}$/.test(input.sha256))) {
    throw new Error('Active boundary integrity mismatch');
  }
  const bytes = fs.readFileSync(entry.rule_path);
  if (sha256(bytes) !== entry.rule_sha256) throw new Error('Active boundary integrity mismatch');
  const scopeMatches = entry.static_inputs.every(required => trace.inputs.some(observed =>
    observed.path === required.path && observed.sha256 === required.sha256));
  return { bytes, scope_matches: scopeMatches };
}

function gateCheckTrace(filename, rulePath) {
  const trace = readJson(filename);
  const { sha256: expected, ...body } = trace;
  if (trace.kind !== 'agent_os.check_trace.v1' || expected !== sha256(JSON.stringify(body)) ||
      typeof trace.reused !== 'boolean' || typeof trace.check?.executed !== 'boolean' ||
      !Array.isArray(trace.check.command) || !trace.check.command.length ||
      !trace.check.command.every(value => typeof value === 'string') ||
      typeof trace.check.cwd !== 'string' || !path.isAbsolute(trace.check.cwd) ||
      !Array.isArray(trace.inputs) || !trace.inputs.length || typeof trace.inputs_unchanged !== 'boolean' ||
      !/^[a-f0-9]{64}$/.test(trace.input_key) ||
      !/^[a-f0-9]{64}$/.test(trace.environment_sha256)) throw new Error('Invalid check execution trace');
  const selection = rulePath ? { bytes: fs.readFileSync(rulePath), scope_matches: true }
    : registeredCheckRule(trace);
  const ruleBytes = selection.bytes;
  const rule = JSON.parse(ruleBytes);
  if (rule?.kind !== 'qbl.boundary.v1' || !Array.isArray(rule.invariants) || !rule.invariants.length ||
      !equal(rule.action, { pass: 'ADMIT', fail: 'HOLD', collision: 'SPLIT' })) throw new Error('Invalid boundary rule');
  const start = performance.now();
  const keyMatches = trace.input_key === sha256(JSON.stringify({ command: trace.check.command,
    cwd: trace.check.cwd, inputs: trace.inputs, environment_sha256: trace.environment_sha256 }));
  const inputsMatchCurrent = currentInputsMatch(trace.inputs);
  const observedInputsMatchCurrent = currentInputsMatch(trace.observed_inputs || []) &&
    Array.isArray(trace.observed_inputs);
  const sensorMatches = trace.sensor_scope === 'node.fs.readFileSync.v1' && trace.sensor_ok === true;
  const results = rule.invariants.map(node => expression(node, trace));
  return { kind: 'agent_os.read_only_gate.v1', evidence_scope: 'recorded_local_trace_not_attestation',
    rule_sha256: sha256(ruleBytes), decisions: [{ candidate: trace.id,
      decision: selection.scope_matches && keyMatches && inputsMatchCurrent && observedInputsMatchCurrent && sensorMatches &&
        results.every(value => value === true) ? 'ADMIT' : 'HOLD',
      evaluation_ms: performance.now() - start,
      failed_invariants: results.flatMap((value, index) => value === true ? [] : [index]),
      scope_matches: selection.scope_matches, key_matches: keyMatches, inputs_match_current: inputsMatchCurrent,
      observed_inputs_match_current: observedInputsMatchCurrent, sensor_matches: sensorMatches,
      prior_verdict: trace.prior?.verdict || null, reused: trace.reused, check_exit_code: trace.check.exit_code }] };
}

function gateRun(runDir, { rulePath, candidateId } = {}) {
  if (fs.lstatSync(runDir).isFile()) {
    if (candidateId !== undefined) throw new Error('A check trace does not accept a candidate selector');
    return gateCheckTrace(runDir, rulePath);
  }
  const root = fs.realpathSync(runDir);
  const ruleBytes = fs.readFileSync(rulePath || defaultRule);
  const rule = JSON.parse(ruleBytes);
  if (rule?.kind !== 'qbl.boundary.v1' || !Array.isArray(rule.invariants) || !rule.invariants.length ||
      !equal(rule.action, { pass: 'ADMIT', fail: 'HOLD', collision: 'SPLIT' })) throw new Error('Invalid boundary rule');
  const manifest = readJson(path.join(root, 'manifest.json'));
  if (!Array.isArray(manifest.candidates) || !manifest.candidates.length) throw new Error('No candidates in run');
  if (new Set(manifest.candidates.map(entry => entry.id)).size !== manifest.candidates.length) {
    throw new Error('Duplicate candidate ID');
  }
  const entries = candidateId ? manifest.candidates.filter(entry => entry.id === candidateId) : manifest.candidates;
  if (!entries.length) throw new Error('Candidate not found');
  const decisions = entries.map(entry => {
    const artifact = fs.readFileSync(child(root, entry.artifact));
    const observed = readJson(child(root, entry.evidence));
    const callId = entry.required_public_command;
    const evidenceMatches = sha256(artifact) === entry.sha256 &&
      observed.artifact_sha256 === entry.sha256 && observed.candidate_id === entry.id &&
      observed.public_result?.command === callId && Array.isArray(observed.native_events);
    const trace = { claim: { required_call_ids: [callId] },
      events: Array.isArray(observed.native_events)
        ? observed.native_events.map(event => ({ ...event, call_id: callId })) : [],
      public_tools: { status: 'complete', records: [{ call_id: callId, result: observed.public_result }] } };
    const start = performance.now();
    const rawDecision = rule.invariants.map(node => expression(node, trace)).every(value => value === true)
      ? rule.action.pass : rule.action.fail;
    return { candidate: entry.id, decision: evidenceMatches ? rawDecision : 'HOLD',
      evaluation_ms: performance.now() - start, evidence_matches: evidenceMatches };
  });
  return { kind: 'agent_os.read_only_gate.v1', evidence_scope: 'supplied_run_files',
    rule_sha256: sha256(ruleBytes), decisions };
}

module.exports = { gateRun };
