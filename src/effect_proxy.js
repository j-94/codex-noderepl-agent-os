'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { hash } = require('./core');

function admissionId(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

function createAdmission({
  allowed_paths = [],
  allowed_ops = [],
  rollback,
  evidence,
  claim_boundary,
  ttl_ms = 5 * 60 * 1000,
  now = Date.now(),
} = {}) {
  const missing = [];
  if (!allowed_paths.length) missing.push('allowed_paths');
  if (!allowed_ops.length) missing.push('allowed_ops');
  if (!rollback) missing.push('rollback');
  if (!evidence || (Array.isArray(evidence) && evidence.length === 0)) missing.push('evidence');
  if (!claim_boundary) missing.push('claim_boundary');
  if (missing.length) throw new Error(`VMAdmission missing required fields: ${missing.join(', ')}`);

  const base = Object.freeze({
    kind: 'VMAdmission',
    allowed_paths: Object.freeze([...allowed_paths]),
    allowed_ops: Object.freeze([...allowed_ops]),
    rollback,
    evidence: Object.freeze(Array.isArray(evidence) ? [...evidence] : evidence),
    claim_boundary,
    receipt_required: true,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl_ms).toISOString(),
  });
  return Object.freeze({ ...base, admission_id: admissionId(base) });
}

function ensureAdmission(token) {
  if (!token || typeof token !== 'object') throw new Error('admission token is required');
  if (token.kind !== 'VMAdmission') throw new Error('admission token must have kind VMAdmission');
  const required = ['admission_id', 'rollback', 'evidence', 'claim_boundary', 'expires_at'];
  const missing = required.filter((field) => !token[field]);
  if (missing.length) throw new Error(`admission token missing required fields: ${missing.join(', ')}`);
  if (token.receipt_required !== true) throw new Error('admission token must require receipt');
  return token;
}

function pathAllowed(candidate, patterns) {
  const normalized = candidate.split(path.sep).join('/');
  return patterns.some((pattern) => {
    const p = String(pattern).split(path.sep).join('/');
    if (p === normalized) return true;
    if (p.endsWith('/**')) return normalized.startsWith(p.slice(0, -3));
    if (p.endsWith('*')) return normalized.startsWith(p.slice(0, -1));
    return false;
  });
}

function validateAdmission(token, { op, target_path, now = Date.now() } = {}) {
  const admission = ensureAdmission(token);
  if (!admission.allowed_ops.includes(op)) throw new Error(`operation not admitted: ${op}`);
  if (Date.parse(admission.expires_at) <= now) throw new Error('admission token expired');
  if (target_path && !pathAllowed(target_path, admission.allowed_paths)) {
    throw new Error(`path not admitted: ${target_path}`);
  }
  return admission;
}

function readIfExists(absPath) {
  try {
    return fs.readFileSync(absPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeFileWithAdmission(token, targetPath, bytes, { cwd = process.cwd(), now = Date.now() } = {}) {
  const admission = validateAdmission(token, { op: 'fs.write', target_path: targetPath, now });
  const absPath = path.resolve(cwd, targetPath);
  const before = readIfExists(absPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
  const after = fs.readFileSync(absPath);
  return Object.freeze({
    kind: 'effect_proxy.receipt.v0',
    admission_id: admission.admission_id,
    op: 'fs.write',
    path: targetPath,
    before_sha256: before ? hash(before.toString('utf8')) : null,
    after_sha256: hash(after.toString('utf8')),
    rollback: admission.rollback,
    evidence: admission.evidence,
    claim_boundary: admission.claim_boundary,
  });
}

function runCommandWithAdmission(token, argv, { cwd = process.cwd(), now = Date.now() } = {}) {
  const admission = validateAdmission(token, { op: 'run_command', now });
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv is required');
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  return Object.freeze({
    kind: 'effect_proxy.receipt.v0',
    admission_id: admission.admission_id,
    op: 'run_command',
    argv: Object.freeze([...argv]),
    status: result.status,
    stdout_sha256: hash(result.stdout || ''),
    stderr_sha256: hash(result.stderr || ''),
    rollback: admission.rollback,
    evidence: admission.evidence,
    claim_boundary: admission.claim_boundary,
  });
}

function readAdmissionFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  createAdmission,
  readAdmissionFile,
  runCommandWithAdmission,
  validateAdmission,
  writeFileWithAdmission,
};
