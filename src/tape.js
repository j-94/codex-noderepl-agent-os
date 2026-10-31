'use strict';

/**
 * tape: one append-only, hash-chained event log with a verifier.
 *
 * The defect this replaces: appendToTape wrote `{timestamp, ...record}` and let
 * callers supply (or omit) the sequence position. Nine record shapes ended up
 * sharing one file, 774 of 802 of them outside any chain, and nothing ever
 * walked the chain to check it.
 *
 * Rules:
 *   - The writer owns the position. Callers pass an event; they never pass a head.
 *   - Every cell carries prev_hash, so a gap or reorder breaks the link.
 *   - verifyTape() walks the file and reports the first break, rather than
 *     assuming a readable file is a valid one.
 *
 * The cell shape is additive: `event` is untouched, so existing readers keep
 * working, and the chain lives in fields they ignore.
 */

const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./core');

const SCHEMA = 'agent_os.tape_cell.v1';
const GENESIS = '0'.repeat(64);

/**
 * A cell's hash covers the position, the previous cell's hash, and the event.
 * Content-addressed on the chain, not on the payload alone: two identical
 * events at different positions must not hash alike.
 */
function cellHash(head, prevHash, event) {
  return hash({ head, prev_hash: prevHash, event });
}

class Tape {
  constructor(file) {
    this.file = file;
    const state = fs.existsSync(file) ? readState(file) : { head: 0, prevHash: GENESIS, lines: 0 };
    this.head = state.head;
    this.prevHash = state.prevHash;
    this.lines = state.lines;
  }

  /** Append an event. The tape decides the position, never the caller. */
  append(event) {
    const head = this.head + 1;
    const cell = {
      schema: SCHEMA,
      head,
      prev_hash: this.prevHash,
      event,
      hash: cellHash(head, this.prevHash, event),
      at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(cell) + '\n');
    this.head = head;
    this.prevHash = cell.hash;
    this.lines += 1;
    return cell;
  }
}

function readState(file) {
  const text = fs.readFileSync(file, 'utf8');
  let head = 0;
  let prevHash = GENESIS;
  let lines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    lines += 1;
    let cell;
    try {
      cell = JSON.parse(line);
    } catch {
      continue; // verification reports it; state just skips it
    }
    if (cell.schema === SCHEMA && Number.isSafeInteger(cell.head)) {
      head = cell.head;
      prevHash = cell.hash;
    }
  }
  return { head, prevHash, lines };
}

/**
 * Walk the file and report the first break. Returns counts so a caller can see
 * how much of the file is actually on the chain, not just whether it parses.
 */
function verifyTape(file) {
  if (!fs.existsSync(file)) return { ok: false, error: 'missing', file };
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  let head = 0;
  let prevHash = GENESIS;
  let onChain = 0;
  let offChain = 0;
  let legacy = 0;
  const legacyHeads = [];
  const problems = [];

  rows.forEach((line, index) => {
    const at = index + 1;
    let cell;
    try {
      cell = JSON.parse(line);
    } catch {
      problems.push({ line: at, problem: 'unparseable' });
      return;
    }
    if (cell.schema !== SCHEMA) {
      if (Number.isSafeInteger(cell.head) && cell.kind) {
        // A legacy kernel cell: chained by head order, but with no prev_hash, so
        // the link cannot be verified. Counted separately and reported, because
        // calling this file valid would claim a check that never ran.
        legacy += 1;
        legacyHeads.push(cell.head);
      } else {
        // Not tape at all: a journal line sharing the file.
        offChain += 1;
      }
      return;
    }
    if (cell.head !== head + 1) {
      problems.push({ line: at, problem: 'head_gap', expected: head + 1, found: cell.head });
      // Keep walking from what the file claims so later cells are still checked.
      head = cell.head - 1;
      prevHash = cell.prev_hash;
    }
    if (cell.prev_hash !== prevHash) {
      problems.push({ line: at, problem: 'prev_hash_mismatch', expected: prevHash, found: cell.prev_hash });
    }
    const expected = cellHash(cell.head, cell.prev_hash, cell.event);
    if (cell.hash !== expected) {
      problems.push({ line: at, problem: 'hash_mismatch', head: cell.head });
    }
    head = cell.head;
    prevHash = cell.hash;
    onChain += 1;
  });

  const legacyGaps = legacyHeads.filter((h, i) => i > 0 && h !== legacyHeads[i - 1] + 1);
  return {
    ok: problems.length === 0 && legacyHeads.length === 0,
    file,
    lines: rows.length,
    on_chain: onChain,
    off_chain: offChain,
    legacy_unchained: legacy,
    legacy_head_gaps: legacyGaps.length,
    chain_head: head,
    problems,
    note: legacyHeads.length
      ? 'legacy cells carry head order but no prev_hash, so their links are unverifiable'
      : null,
  };
}

module.exports = { Tape, verifyTape, cellHash, SCHEMA, GENESIS };
