'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { hash, freeze } = require('./core');

const CALLS = new Set(['function_call', 'custom_tool_call']);
const OUTPUTS = new Set(['function_call_output', 'custom_tool_call_output']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealed = body => freeze({ ...body, hash: hash(body) });

function discoverRollout(threadId, codexHome) {
  const time = parseInt(threadId.replace(/-/g, '').slice(0, 12), 16);
  const matches = [];
  for (const offset of [-86400000, 0, 86400000]) {
    const date = new Date(time + offset).toISOString().slice(0, 10).split('-');
    const directory = path.join(codexHome, 'sessions', ...date);
    if (!fs.existsSync(directory)) continue;
    const entries = fs.readdirSync(directory);
    if (entries.length > 5000) throw new Error('directory_bound');
    for (const file of entries) if (file.startsWith('rollout-') && file.endsWith(`-${threadId}.jsonl`)) matches.push(path.join(directory, file));
  }
  if (matches.length > 1) throw new Error('ambiguous_rollout');
  return matches[0] || null;
}

function cleanText(value, counts) {
  return value.replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+=*/gi, () => { counts.redactions++; return 'Bearer [REDACTED]'; })
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][a-zA-Z0-9_-]{16,}/g, () => { counts.redactions++; return '[REDACTED_TOKEN]'; })
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, (match, prefix) => { counts.redactions++; return `${prefix}[REDACTED]`; });
}

function publicValue(value, counts) {
  if (typeof value === 'string') return cleanText(value, counts);
  if (Array.isArray(value)) return value.filter(item => item && ['text', 'input_text', 'output_text'].includes(item.type) && typeof item.text === 'string')
    .map(item => ({ type: item.type, text: cleanText(item.text, counts) }));
  return null;
}

function snapshotPublicTools({ threadId, cwd, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  rolloutPath, maxSourceBytes = 16 * 1024 * 1024, maxRecords = 512, maxRecordBytes = 65536, maxSnapshotBytes = 2 * 1024 * 1024 }) {
  const base = { kind: 'agent_os.public_tools.v1', thread_id: threadId || null, cwd: typeof cwd === 'string' ? path.resolve(cwd) : null,
    status: 'unavailable', reason: null, source: null, records: [], matched_calls: 0, unmatched_call_ids: [], unmatched_output_count: 0, redactions: 0 };
  const finish = (status, reason) => sealed({ ...base, status, reason });
  if (typeof threadId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(threadId) || !base.cwd) return finish('unavailable', 'missing_or_invalid_run_identity');
  if (![maxSourceBytes, maxRecords, maxRecordBytes, maxSnapshotBytes].every(n => Number.isSafeInteger(n) && n > 0)) return finish('held', 'invalid_bounds');
  let filename;
  try { filename = rolloutPath ? path.resolve(rolloutPath) : discoverRollout(threadId, codexHome); }
  catch { return finish('held', 'rollout_discovery_failed'); }
  if (!filename) return finish('unavailable', 'rollout_not_found');
  let bytes;
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile()) return finish('held', 'rollout_not_regular_file');
    if (stat.size > maxSourceBytes) return finish('held', 'source_size_bound');
    const descriptor = fs.openSync(filename, 'r');
    try {
      bytes = Buffer.alloc(maxSourceBytes + 1);
      let size = 0;
      while (size < bytes.length) {
        const received = fs.readSync(descriptor, bytes, size, bytes.length - size, size);
        if (!received) break;
        size += received;
      }
      if (size > maxSourceBytes) return finish('held', 'source_size_bound');
      const after = fs.fstatSync(descriptor);
      if (size !== after.size || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ino !== after.ino) return finish('held', 'source_changed_during_snapshot');
      bytes = bytes.subarray(0, size);
    } finally { fs.closeSync(descriptor); }
  } catch { return finish('unavailable', 'rollout_unreadable'); }
  base.source = { path: filename, sha256: digest(bytes), bytes: bytes.length };
  const pending = new Map();
  const allCalls = new Set();
  const records = [];
  let meta = false;
  let snapshotBytes = 0;
  const counts = { redactions: 0 };
  const lines = bytes.toString('utf8').split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    let row;
    try { row = JSON.parse(lines[index]); } catch { return finish('held', 'malformed_rollout'); }
    const item = row.payload;
    if (row.type === 'session_meta') {
      if (meta || item?.id !== threadId || (item.cwd !== undefined && (typeof item.cwd !== 'string' || path.resolve(item.cwd) !== base.cwd))) return finish('held', 'session_identity_mismatch');
      meta = true;
      continue;
    }
    if (row.type !== 'response_item' || !item || (!CALLS.has(item.type) && !OUTPUTS.has(item.type))) continue;
    if (typeof item.call_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(item.call_id)) return finish('held', 'invalid_call_identity');
    const payload = { type: item.type, call_id: item.call_id };
    if (CALLS.has(item.type)) {
      if (allCalls.has(item.call_id)) return finish('held', 'duplicate_call_identity');
      if (typeof item.name !== 'string' || !/^[a-zA-Z0-9_.:/-]{1,200}$/.test(item.name)) return finish('held', 'invalid_tool_name');
      allCalls.add(item.call_id); pending.set(item.call_id, item.type);
      payload.name = item.name;
      payload[item.type === 'function_call' ? 'arguments' : 'input'] = publicValue(item[item.type === 'function_call' ? 'arguments' : 'input'], counts);
    } else {
      const expected = item.type === 'function_call_output' ? 'function_call' : 'custom_tool_call';
      if (pending.get(item.call_id) !== expected) { base.unmatched_output_count++; continue; }
      pending.delete(item.call_id); base.matched_calls++;
      payload.output = publicValue(item.output, counts);
    }
    const record = { line: index + 1, timestamp: typeof row.timestamp === 'string' ? row.timestamp : null, payload };
    const size = Buffer.byteLength(JSON.stringify(record), 'utf8');
    snapshotBytes += size;
    if (size > maxRecordBytes || snapshotBytes > maxSnapshotBytes || records.length >= maxRecords) return finish('held', 'public_record_bound');
    records.push(record);
  }
  if (!meta) return finish('held', 'missing_session_metadata');
  base.records = records;
  base.unmatched_call_ids = [...pending.keys()];
  base.redactions = counts.redactions;
  if (base.unmatched_call_ids.length || base.unmatched_output_count) return finish('incomplete', 'unmatched_tool_records');
  return finish('complete', 'all_observed_public_calls_matched');
}

module.exports = { snapshotPublicTools };
