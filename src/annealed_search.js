'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { hash } = require('./core');

const CODEDB_BIN = '/Users/jobs/bin/codedb';
const HISTORY_WORKER_SCRIPT = '/Users/jobs/Desktop/data_prep_stage/bin/history_worker.py';
const NSTAR_NODES_PATH = '/Users/jobs/Developer/system/nstar-bit/nstar_nodes.json';
const PYTHON_BIN = process.env.DATA_PREP_PYTHON || (fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3');
const DEFAULT_WORKSPACE = path.resolve(__dirname, '..');

function isSymbolQuery(query) {
  const trimmed = query.trim();
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]{2,}$/.test(trimmed)) return true;
  if (/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/.test(trimmed)) return true;
  return false;
}

function queryCodeDbDaemon(pathname, paramKey, paramVal) {
  try {
    const url = `http://127.0.0.1:7719${pathname}?${paramKey}=${encodeURIComponent(paramVal)}`;
    const res = spawnSync('curl', ['-s', '--max-time', '0.1', url], {
      encoding: 'utf8',
      timeout: 150,
    });
    if (res.status === 0 && res.stdout) {
      const data = JSON.parse(res.stdout);
      if (data && Array.isArray(data.results)) {
        return data.results;
      }
    }
  } catch {}
  return null;
}

function runCodeDbFind(symbol, workspace = DEFAULT_WORKSPACE) {
  const started = process.hrtime.bigint();
  const daemonResults = queryCodeDbDaemon('/explore/symbol', 'name', symbol);
  if (daemonResults !== null) {
    const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
    const lines = daemonResults.map(r => `✓ ${r.kind || 'symbol'} ${r.name || symbol}  ${r.path}:${r.line}`);
    return {
      source: 'codedb:ast_find',
      symbol,
      elapsed_ms,
      matches: lines,
      found: lines.length > 0,
    };
  }
  if (!fs.existsSync(CODEDB_BIN)) return null;
  const res = spawnSync(CODEDB_BIN, [workspace, 'find', symbol], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (res.status !== 0 || !res.stdout) return null;

  const lines = res.stdout.trim().split('\n').filter(l => l.includes('src/') || l.includes('test/'));
  return {
    source: 'codedb:ast_find',
    symbol,
    elapsed_ms,
    matches: lines,
    found: lines.length > 0,
  };
}

function runCodeDbSearch(query, workspace = DEFAULT_WORKSPACE) {
  const started = process.hrtime.bigint();
  const daemonResults = queryCodeDbDaemon('/explore/search', 'q', query);
  if (daemonResults !== null) {
    const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
    const lines = daemonResults.map(r => `  ${r.path}:${r.line}  ${r.text || ''}`);
    return {
      source: 'codedb:trigram_search',
      query,
      elapsed_ms,
      matches: lines.slice(0, 10),
      found: lines.length > 0,
    };
  }
  if (!fs.existsSync(CODEDB_BIN)) return null;
  const res = spawnSync(CODEDB_BIN, [workspace, 'search', query], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (res.status !== 0 || !res.stdout) return null;

  const lines = res.stdout.trim().split('\n').filter(l => l.trim().length > 0 && !l.startsWith('✓ indexed') && !l.includes('✗ no results') && !l.includes('✗ not found'));
  return {
    source: 'codedb:trigram_search',
    query,
    elapsed_ms,
    matches: lines.slice(0, 10),
    found: lines.length > 0,
  };
}

function runHistorySearch(query, topK = 5) {
  const started = process.hrtime.bigint();
  // Fast path: query warm daemon on :7720
  try {
    const url = `http://127.0.0.1:7720/search?q=${encodeURIComponent(query)}&top_k=${topK}`;
    const res = spawnSync('curl', ['-s', '--max-time', '0.2', url], {
      encoding: 'utf8',
      timeout: 250,
    });
    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout);
      if (parsed && Array.isArray(parsed.result)) {
        const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
        return {
          source: 'history_worker:bm25',
          query,
          elapsed_ms,
          matches: parsed.result,
          found: parsed.result.length > 0,
        };
      }
    }
  } catch {}

  // Fallback to one-shot python CLI
  if (!fs.existsSync(HISTORY_WORKER_SCRIPT)) return null;
  const res = spawnSync(PYTHON_BIN, [HISTORY_WORKER_SCRIPT, 'search', '--query', query, '--top-k', String(topK)], {
    encoding: 'utf8',
    timeout: 10000,
  });
  const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (res.status !== 0 || !res.stdout) return null;

  try {
    const parsed = JSON.parse(res.stdout);
    return {
      source: 'history_worker:bm25',
      query,
      elapsed_ms,
      matches: parsed.result || [],
      found: (parsed.result || []).length > 0,
    };
  } catch {
    return null;
  }
}

function runEpistemicSearch(query, limit = 5) {
  if (!fs.existsSync(NSTAR_NODES_PATH)) return null;
  const started = process.hrtime.bigint();
  try {
    const nodes = JSON.parse(fs.readFileSync(NSTAR_NODES_PATH, 'utf8'));
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const node of nodes) {
      const id = (node.id || '').toLowerCase();
      const condition = (node.condition || '').toLowerCase();
      let matchScore = 0;
      for (const term of terms) {
        if (id.includes(term)) matchScore += 2.0;
        else if (condition.includes(term)) matchScore += 1.0;
      }
      if (matchScore > 0) {
        scored.push({
          id: node.id,
          prime: node.prime_id,
          reinforcements: node.reinforcements,
          threshold: node.threshold,
          condition: node.condition,
          score: matchScore * (1.0 + Math.log10(1 + (node.reinforcements || 1))),
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const matches = scored.slice(0, limit);
    const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      source: 'nstar:epistemic_graph',
      query,
      elapsed_ms,
      matches,
      found: matches.length > 0,
    };
  } catch {
    return null;
  }
}

function calculateEnergy({ elapsed_ms, count, expected_min = 1 }) {
  // Energy = latency penalty + uncertainty (missing results) + distraction penalty (oversized results)
  const latencyPenalty = Math.min(1.0, elapsed_ms / 100.0);
  const uncertainty = count < expected_min ? 1.0 : 0.0;
  const distractionPenalty = count > 10 ? 0.2 : 0.0;
  return Number((latencyPenalty * 0.4 + uncertainty * 0.5 + distractionPenalty * 0.1).toFixed(4));
}

function annealedSearch(query, { workspace = DEFAULT_WORKSPACE, topK = 5, mode = 'auto' } = {}) {
  const started = process.hrtime.bigint();
  const trimmed = String(query || '').trim();
  if (!trimmed) throw new Error('Query must not be empty');

  let strategy = 'hybrid';
  let astResults = null;
  let historyResults = null;

  if (mode === 'ast' || (mode === 'auto' && isSymbolQuery(trimmed))) {
    strategy = 'ast_symbol';
    const findRes = runCodeDbFind(trimmed, workspace);
    astResults = (findRes && findRes.found) ? findRes : runCodeDbSearch(trimmed, workspace);
    // If AST search found exact symbol, anneal immediately (freeze at global minimum)
    if (astResults && astResults.found) {
      const totalElapsed = Number(process.hrtime.bigint() - started) / 1e6;
      const energy = calculateEnergy({ elapsed_ms: totalElapsed, count: astResults.matches.length });
      const payload = {
        kind: 'agent_os.annealed_search.v1',
        query: trimmed,
        strategy,
        energy,
        elapsed_ms: totalElapsed,
        primary_source: astResults.source,
        results: astResults.matches,
      };
      return { ...payload, receipt_hash: hash(payload) };
    }
  }

  if (mode === 'epistemic') {
    strategy = 'nstar_epistemic';
    const epRes = runEpistemicSearch(trimmed, topK);
    if (epRes && epRes.found) {
      const totalElapsed = Number(process.hrtime.bigint() - started) / 1e6;
      const energy = calculateEnergy({ elapsed_ms: totalElapsed, count: epRes.matches.length });
      const payload = {
        kind: 'agent_os.annealed_search.v1',
        query: trimmed,
        strategy,
        energy,
        elapsed_ms: totalElapsed,
        primary_source: epRes.source,
        results: epRes.matches,
      };
      return { ...payload, receipt_hash: hash(payload) };
    }
  }

  if (mode === 'auto' && !isSymbolQuery(trimmed)) {
    const epRes = runEpistemicSearch(trimmed, topK);
    // If epistemic graph hits high-confidence concepts, use it
    if (epRes && epRes.found && epRes.matches[0].score >= 3.0) {
      const totalElapsed = Number(process.hrtime.bigint() - started) / 1e6;
      const energy = calculateEnergy({ elapsed_ms: totalElapsed, count: epRes.matches.length });
      const payload = {
        kind: 'agent_os.annealed_search.v1',
        query: trimmed,
        strategy: 'nstar_epistemic',
        energy,
        elapsed_ms: totalElapsed,
        primary_source: epRes.source,
        results: epRes.matches,
      };
      return { ...payload, receipt_hash: hash(payload) };
    }
  }

  if (mode === 'history' || (mode === 'auto' && !isSymbolQuery(trimmed))) {
    strategy = 'history_bm25';
    historyResults = runHistorySearch(trimmed, topK);
    if (historyResults && historyResults.found) {
      const totalElapsed = Number(process.hrtime.bigint() - started) / 1e6;
      const energy = calculateEnergy({ elapsed_ms: totalElapsed, count: historyResults.matches.length });
      const payload = {
        kind: 'agent_os.annealed_search.v1',
        query: trimmed,
        strategy,
        energy,
        elapsed_ms: totalElapsed,
        primary_source: historyResults.source,
        results: historyResults.matches,
      };
      return { ...payload, receipt_hash: hash(payload) };
    }
  }

  // Hybrid Fallback: query all engines and cool down to lowest energy candidate
  strategy = 'hybrid_anneal';
  astResults = runCodeDbFind(trimmed, workspace) || runCodeDbSearch(trimmed, workspace);
  const epResults = runEpistemicSearch(trimmed, topK);
  historyResults = runHistorySearch(trimmed, topK);

  const candidates = [];
  if (astResults && astResults.found) candidates.push({ source: 'ast', data: astResults });
  if (epResults && epResults.found) candidates.push({ source: 'epistemic', data: epResults });
  if (historyResults && historyResults.found) candidates.push({ source: 'history', data: historyResults });

  const totalElapsed = Number(process.hrtime.bigint() - started) / 1e6;
  const matchCount = candidates.reduce((acc, c) => acc + (c.data.matches?.length || 0), 0);
  const energy = calculateEnergy({ elapsed_ms: totalElapsed, count: matchCount });

  const payload = {
    kind: 'agent_os.annealed_search.v1',
    query: trimmed,
    strategy,
    energy,
    elapsed_ms: totalElapsed,
    candidates: candidates.map(c => ({ source: c.data.source, matches: c.data.matches })),
  };
  return { ...payload, receipt_hash: hash(payload) };
}

module.exports = {
  annealedSearch,
  isSymbolQuery,
  runCodeDbFind,
  runCodeDbSearch,
  runHistorySearch,
  runEpistemicSearch,
  calculateEnergy,
};
