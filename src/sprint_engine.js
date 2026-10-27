'use strict';

const { spawnSync } = require('child_process');
const http = require('http');

async function runSprint(query) {
  const started = process.hrtime.bigint();
  const fs = require('fs');
  const path = require('path');
  const results = {
    query,
    timestamp: new Date().toISOString(),
    lobes: {}
  };

  // LOBE 1: Turn-0 Memory & Intent Scoring (what_next.py)
  const t0_l1 = process.hrtime.bigint();
  try {
    const p1 = spawnSync('python3', [
      '/Users/jobs/Developer/system/agent-memory/tools/what_next.py',
      '--query', query
    ], { encoding: 'utf8', timeout: 5000 });
    const l1_elapsed = Number(process.hrtime.bigint() - t0_l1) / 1e6;
    const lines = (p1.stdout || '').split('\n').filter(Boolean);
    const topIntents = lines.filter(l => l.includes('intent_')).slice(0, 3);
    const receiptLine = lines.find(l => l.includes('Receipt') || l.includes('receipt'));
    results.lobes.lobe1_memory = {
      elapsed_ms: l1_elapsed,
      top_intents: topIntents,
      receipt: receiptLine || null
    };
  } catch (err) {
    results.lobes.lobe1_memory = { error: err.message };
  }

  // LOBE 2: Structural Topic Surface (control_surface_topic_model.py)
  const t0_l2 = process.hrtime.bigint();
  try {
    const p2 = spawnSync('python3', [
      '/Users/jobs/Desktop/Desktop(archive)/scripts/control_surface_topic_model.py', 'query',
      '--delta', '/Users/jobs/Desktop/Desktop(archive)/runs/control_surface/topic-model/topic_model_graph_delta.json',
      '--query-text', query, '--k-topics', '1', '--k-files', '3'
    ], { encoding: 'utf8', timeout: 5000 });
    const l2_elapsed = Number(process.hrtime.bigint() - t0_l2) / 1e6;
    const lines = (p2.stdout || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('- ') || l.startsWith('TOPIC:'));
    results.lobes.lobe2_topic_surface = {
      elapsed_ms: l2_elapsed,
      top_matches: lines.slice(0, 4)
    };
  } catch (err) {
    results.lobes.lobe2_topic_surface = { error: err.message };
  }

  // LOBE 3: CodeDB AST Daemon (:7719)
  const t0_l3 = process.hrtime.bigint();
  try {
    const astRes = await new Promise((resolve) => {
      const firstWord = query.split(/\s+/)[0];
      const req = http.get('http://127.0.0.1:7719/explore/search?q=' + encodeURIComponent(firstWord), (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        });
      });
      req.on('error', err => resolve({ error: err.message }));
      req.setTimeout(2000, () => { req.destroy(); resolve({ timeout: true }); });
    });
    const l3_elapsed = Number(process.hrtime.bigint() - t0_l3) / 1e6;
    results.lobes.lobe3_codedb_ast = {
      elapsed_ms: l3_elapsed,
      matches_count: (astRes.results || []).length,
      sample_results: (astRes.results || []).slice(0, 3)
    };
  } catch (err) {
    results.lobes.lobe3_codedb_ast = { error: err.message };
  }

  // LOBE 4: Short-Circuit Primitive Memoization or Neural Proposer via xAI Grok 4.7
  const t0_l4 = process.hrtime.bigint();
  try {
    let memoized = null;
    const regPath = path.resolve(__dirname, '..', 'runs', 'autopoiesis', 'primitives_registry.json');
    if (fs.existsSync(regPath)) {
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      const qLower = query.toLowerCase();
      const match = (reg.primitives || []).find(p => {
        const idMatch = p.id.toLowerCase().split('_').some(term => term.length > 3 && qLower.includes(term));
        const descMatch = p.description.toLowerCase().split(/\s+/).filter(w => w.length > 4).some(term => qLower.includes(term));
        return idMatch || descMatch;
      });
      if (match) {
        memoized = {
          primitive_id: match.id,
          description: match.description,
          code_hash: match.code_hash,
          cached: true
        };
      }
    }

    if (memoized) {
      const l4_elapsed = Number(process.hrtime.bigint() - t0_l4) / 1e6;
      results.lobes.lobe4_neural_proposer = {
        elapsed_ms: l4_elapsed,
        proposal: '[MEMOIZED  RULE]: ' + memoized.description,
        primitive: memoized,
        source: 'primitives_registry'
      };
    } else {
      const { evalProposerGate } = require('./proposer_gate');
      const hasAst = Boolean(results.lobes.lobe3_codedb_ast?.matches_count > 0);
      const hasMem = Boolean(results.lobes.lobe1_memory?.top_intents?.length > 0);
      const gateDecision = evalProposerGate({ hasAstBounds: hasAst, hasMemory: hasMem, requestedThinking: 'low' });

      if (gateDecision.decision === 'hold') {
        const l4_elapsed = Number(process.hrtime.bigint() - t0_l4) / 1e6;
        results.lobes.lobe4_neural_proposer = {
          elapsed_ms: l4_elapsed,
          held: true,
          proposal: '[PROPOSER_HOLD: ' + gateDecision.reason + ']',
          neural_live: false,
          gate_decision: gateDecision,
          quad_stack_active: gateDecision.mode === 'compound_quad'
        };
      } else {
        const piPrompt = 'Given intent "' + query + '", state the single-line operational invariant in under 15 words.';
        const p4 = spawnSync('/opt/homebrew/bin/pi', ['-a', '-nt', '--thinking', gateDecision.thinking, '-p', piPrompt], {
          encoding: 'utf8',
          timeout: (gateDecision.timeout_s || 6) * 1000,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        const l4_elapsed = Number(process.hrtime.bigint() - t0_l4) / 1e6;
        const rawProposal = (p4.stdout || '').trim();
        results.lobes.lobe4_neural_proposer = {
          elapsed_ms: l4_elapsed,
          proposal: rawProposal || '[SYNTHESIS FALLBACK: Evaluated deterministically via local AST gates]',
          neural_live: Boolean(rawProposal && !p4.error),
          gate_decision: gateDecision,
          quad_stack_active: gateDecision.mode === 'compound_quad'
        };
      }
    }
  } catch (err) {
    results.lobes.lobe4_neural_proposer = { error: err.message };
  }

  results.total_elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;

  // Canonical Turn Ledger Integration (ties sprint to system_frontdoor)
  try {
    const frontdoorScript = "/Users/jobs/Desktop/data_prep_stage/work/system_frontdoor.py";
    if (fs.existsSync(frontdoorScript)) {
      const commitRes = spawnSync("python3", [
        frontdoorScript, "commit-turn",
        "--query", query,
        "--route", "sprint_4lobe_mesh",
        "--surface", "agent-os/sprint_engine",
        "--receipts", JSON.stringify({
          elapsed_ms: results.total_elapsed_ms,
          lobe1_receipt: results.lobes.lobe1_memory?.receipt || null,
          primitive_id: results.lobes.lobe4_neural_proposer?.primitive?.primitive_id || null
        }),
        "--decision", JSON.stringify({
          status: "ADMITTED",
          lobes_evaluated: Object.keys(results.lobes).length
        }),
        "--compact"
      ], {
        encoding: "utf8",
        timeout: 2000,
        env: { ...process.env, PYTHONPATH: "/Users/jobs/Desktop/data_prep_stage" }
      });
      if (commitRes.status === 0 && commitRes.stdout) {
        results.canonical_turn = JSON.parse(commitRes.stdout);
      }
    }
  } catch {}
  return results;
}

module.exports = { runSprint };
