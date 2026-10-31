'use strict';

/**
 * standing_goal: one goal with a long horizon and an ordered ladder of rungs.
 *
 * A rung is a claim about the system that is either measured (a command whose
 * exit status is the verdict) or unmeasurable right now (a blocker naming what
 * would make it measurable). The goal advances only by clearing the first
 * unmet rung, and it never rewrites the rung above it to make it pass.
 *
 * Every rung carries the exact command that proves it and the surface that
 * command reads. If a rung cannot name both, it is not a rung.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hash } = require('./core');
const { createAdmission, writeFileWithAdmission } = require('./effect_proxy');

const SCHEMA = 'agent_os.standing_goal.v1';
const ROOT = path.resolve(__dirname, '..');
const LEDGER = 'runs/ruliad/standing_goal_ledger.jsonl';
const PROGRESS = 'runs/ruliad/standing_goal_progress.json';

const GOAL = Object.freeze({
  schema: SCHEMA,
  id: 'agent-os.self-measurement',
  stance:
    'Every claim Agent OS makes about itself is produced by running it, and any claim it cannot produce is recorded as unproduced.',
  horizon:
    'Reach the state where the heldout lane can be decided by evidence: a four-lane proof gate that either promotes or blocks for a reason the system itself can name and then fix.',
  authority: 'full_autonomy_on_main',
  non_goals: Object.freeze([
    'editing a gate threshold to make a lane pass',
    'writing a promotion decision the scorer did not compute',
    'counting a route match as evidence of task success',
  ]),
});

/** Each rung: id, claim, prove (argv to run), reads (surface), unlocks (next). */

// R1 replays the report the way it was produced: through the learned project
// the report names. fastRoute alone is the untrained baseline — replaying with
// it proves only that the baseline is self-consistent, and it silently fails
// whenever a cue was learned. The report carries the project digest it was
// scored under, so this proof recomputes that digest before comparing rows.
const R1_REPLAY_SOURCE = `const crypto = require('crypto');
const fs = require('fs');
const { routeWithProject } = require('./src/improvement_routing');
const report = JSON.parse(fs.readFileSync('runs/ruliad/heldout_report.json', 'utf8'));
const checkpointPath = report.replay && report.replay.checkpoint;
if (!checkpointPath) { console.error('report has no replay provenance'); process.exit(1); }
let project;
try { project = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')).state.project; }
catch (err) { console.error('checkpoint unreadable: ' + err.message); process.exit(2); }
const digest = crypto.createHash('sha256').update(JSON.stringify(project)).digest('hex');
if (report.replay.project_sha256 && digest !== report.replay.project_sha256) {
  console.error('checkpoint digest changed since the report was scored'); process.exit(3);
}
const rows = Array.isArray(report.rows) ? report.rows : [];
if (rows.length === 0) { console.error('report has no rows'); process.exit(4); }
const bad = [];
for (const row of rows) {
  let actual;
  try { actual = routeWithProject(row.intent, project).route; }
  catch (err) { actual = 'error:' + err.message; }
  if (actual !== row.candidate) bad.push(row.intent + ' expected=' + row.candidate + ' actual=' + actual);
}
if (bad.length) { console.error(bad.join(String.fromCharCode(10))); process.exit(5); }
process.exit(0);
`;

const LADDER = Object.freeze([
  {
    id: 'R0',
    claim: 'The proof gate reads the evidence it is pointed at.',
    prove: ['node', ['-e', `const {proofStatus}=require('./src/proof');process.env.AGENT_OS_HELDOUT_REPORT='runs/ruliad/heldout_report.json';const r=proofStatus();process.exit(r.missing_for_promotion.join('|').includes('aggregate scorer')?0:1)`]],
    reads: 'src/proof.js:defaultHeldoutReport',
    status: 'done',
    evidence: 'Env read lazily; CLI now reports the aggregate-scorer blocker instead of "missing 20 pairs" when the report exists.',
  },
  {
    id: 'R1',
    claim: 'The router is reproducible: an independent replay of the heldout report reproduces every row.',
    prove: ['node', ['-e', R1_REPLAY_SOURCE]],
    reads: 'src/improvement_routing.js',
    status: 'open',
    blocker: null,
  },
  {
    id: 'R2',
    claim: 'A route match is not a task outcome: goal routing is measured separately from task success.',
    prove: ['node', ['-e', `const fs=require('fs');const d='runs/ruliad/outcome_eval';let f=null;try{f=fs.readdirSync(d).filter(n=>n.endsWith('.json')).sort().at(-1)}catch{}if(!f){console.error('no outcome_eval report');process.exit(1)}const r=JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));if(r.route_match_is_outcome!==false)process.exit(2);if(!(r.total>0)||typeof r.executed!=='number')process.exit(3);process.exit(0)`]],
    reads: 'runs/ruliad/outcome_eval/*.json',
    status: 'proved',
    blocker: null,
  },
  {
    id: 'R3',
    claim: 'Live task execution is measured: each reached goal is executed, not just routed.',
    prove: ['node', ['-e', `const fs=require('fs');const path=require('path');const {bindCapabilities}=require('./src/capability_bind');const r=JSON.parse(fs.readFileSync('runs/ruliad/dogfood_receipt.json','utf8'));const {extractGoalIds}=require('./src/capability_bind');const E='/Users/jobs/Desktop/tmp-meta3-engine-test';const goals=extractGoalIds(fs.readFileSync(E+'/src/engine/mod.rs','utf8'));const ing=fs.readdirSync(E+'/runs/foundations_ingest').filter(n=>fs.existsSync(E+'/runs/foundations_ingest/'+n+'/capability_inventory.json')).map(n=>({n,at:fs.statSync(E+'/runs/foundations_ingest/'+n).mtimeMs})).sort((a,b)=>b.at-a.at);if(!ing.length){console.error('no capability inventory');process.exit(4)}const dir=E+'/runs/foundations_ingest/'+ing[0].n;const inventory=JSON.parse(fs.readFileSync(dir+'/capability_inventory.json','utf8'));const tools=JSON.parse(fs.readFileSync(dir+'/synthesized_tools.json','utf8'));const b=bindCapabilities({inventory,tools,goals,generatedAt:null});const need=[];if(!(r.goals_declared>0))need.push('no goals declared');if(r.goals_declared!==b.goal_count)need.push('declared '+r.goals_declared+' != live '+b.goal_count);if(!(r.goals_reached>0))need.push('no goal reached');if(!(r.goals_reached<=r.goals_declared))need.push('reached exceeds declared');if(r.live.rejected_as_unknown>0)need.push(r.live.rejected_as_unknown+' unknown');if(!(r.live.unreachable===0))need.push('engine unreachable');if(need.length){console.error(need.join('; '));process.exit(1)}process.exit(0)`]],
    reads: 'runs/ruliad/dogfood_receipt.json',
    status: 'proved',
    blocker: null,
  },
  {
    id: 'R4',
    claim: 'The heldout lane decides on evidence: 20 pairs, computed metrics, and a scorer verdict.',
    prove: ['node', ['-e', `const fs=require('fs');const {proofStatus}=require('./src/proof');const agg='runs/ruliad/heldout_aggregate.json';if(!fs.existsSync(agg)){console.error('no aggregate; run scripts/heldout_score.js');process.exit(3)}process.env.AGENT_OS_HELDOUT_REPORT=agg;const s=proofStatus();console.log(JSON.stringify({decision:s.decision,missing:s.missing_for_promotion}));process.exit(s.missing_for_promotion.length===0?0:1)`]],
    reads: 'runs/ruliad/heldout_aggregate.json + src/proof.js',
    status: 'open',
    blocker: null,
  },
  {
    id: 'R5',
    claim: 'Token economy is measured: the system reports where its own input tokens go from real transcripts, not from estimates.',
    prove: ['node', ['-e', `const fs=require('fs');const one=JSON.parse(fs.readFileSync('runs/ruliad/token_economy_receipt.json','utf8'));const two=JSON.parse(fs.readFileSync('runs/ruliad/token_economy_receipt_current.json','utf8'));const bad=[];for(const [n,r] of [['first',one],['second',two]]){if(r.schema!=='agent_os.token_economy_receipt.v1')bad.push(n+': wrong schema');if(!(r.billed_tokens>0))bad.push(n+': no billed tokens');if(!(r.turns>0))bad.push(n+': no turns');if(r.fresh_input+r.cache_read>r.billed_tokens)bad.push(n+': input exceeds billed');}if(one.session===two.session)bad.push('both receipts cite the same session, so nothing was reproduced');console.log(JSON.stringify({sessions:[one.session,two.session],billed:[one.billed_tokens,two.billed_tokens],bad}));process.exit(bad.length===0?0:1)`]],
    reads: 'runs/ruliad/token_economy_receipt{,_current}.json',
    status: 'open',
    blocker: 'Two independent sessions reproduce the measurement. The lever is not yet applied: 40 of 612 tool results carry 84% of tool-result context.',
  },
]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Progress is what the ledger says, not what the source says. */
function measuredProgress() {
  const done = new Set();
  try {
    for (const line of fs.readFileSync(path.join(ROOT, LEDGER), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      // Two shapes on one file: pre-tape rows at top level, tape cells under event.
      const row = parsed.schema === 'agent_os.tape_cell.v1' ? parsed.event : parsed;
      if (row.verdict === 'pass' && row.rung) done.add(row.rung);
    }
  } catch {
    // no ledger yet
  }
  return done;
}

function firstOpen() {
  const done = measuredProgress();
  return LADDER.find((rung) => !done.has(rung.id)) || null;
}

function once(rung, timeoutMs) {
  const [bin, args] = rung.prove;
  const res = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, shell: false });
  return { exit: res.status, verdict: res.status === 0 ? 'pass' : 'fail', stderr: (res.stderr || '').slice(-800) };
}

/** A claim proved once is a sample; a claim proved n times is a claim. */
function prove(rung, { timeoutMs = 120000, runs = 1 } = {}) {
  const samples = [];
  for (let i = 0; i < Math.max(1, runs); i += 1) samples.push(once(rung, timeoutMs));
  const passes = samples.filter((s) => s.verdict === 'pass').length;
  const verdict = passes === samples.length ? 'pass' : passes === 0 ? 'fail' : 'flaky';
  return {
    rung: rung.id,
    claim: rung.claim,
    reads: rung.reads,
    verdict,
    runs: samples.length,
    passes,
    exit: samples.at(-1)?.exit ?? null,
    stderr: samples.map((s) => s.stderr).filter(Boolean).at(-1) || '',
    at: new Date().toISOString(),
  };
}

function appendLedger(row) {
  const { Tape } = require('./tape');
  // The tape owns the sequence. The row's own hash stays as a content hash, but
  // position and linkage now come from one writer instead of this function.
  return new Tape(path.join(ROOT, LEDGER)).append({ kind: 'rung', ...row, content_hash: hash(row) });
}

/**
 * advance: prove the first open rung. On pass, move to the next. On fail,
 * record the failure and keep the goal on that rung. Never skip a rung.
 */
function advance({ dryRun = false, runs = 1 } = {}) {
  const rung = firstOpen();
  if (!rung) return { goal: GOAL.id, state: 'complete', ladder: LADDER.map((r) => r.id) };
  if (dryRun) return { goal: GOAL.id, state: 'open', rung: rung.id, claim: rung.claim, prove: rung.prove, reads: rung.reads, blocker: rung.blocker || null };
  const row = prove(rung, { runs });
  appendLedger(row);
  return { goal: GOAL.id, state: row.verdict === 'pass' ? 'advanced' : 'blocked', ...row };
}

/** Snapshot the ladder with measured status, for a human or a UI. */
function status({ samples = null } = {}) {
  const done = measuredProgress();
  const verdicts = {};
  if (samples && typeof samples === 'object') {
    for (const [id, list] of Object.entries(samples)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      const passes = list.filter((s) => s.verdict === 'pass').length;
      const fails = list.length - passes;
      verdicts[id] = { verdict: passes === 0 ? 'fail' : fails === 0 ? 'pass' : 'flaky', runs: list.length, passes, fails };
    }
  }
  return {
    goal: GOAL.id,
    stance: GOAL.stance,
    rungs: LADDER.map((rung) => ({
      id: rung.id,
      claim: rung.claim,
      reads: rung.reads,
      status: done.has(rung.id) ? 'proved' : rung.status === 'done' ? 'asserted' : 'open',
      blocker: rung.blocker || null,
    })),
    next: firstOpen()?.id || null,
    completed: done.size,
    total: LADDER.length,
    verdicts,
    // The monitor writes an escalation when it cannot repair what it observes. Nothing read that file,
    // so a stall was invisible unless someone knew the path. It is part of the status now: the surface
    // that says where the ladder stands is also the surface that says the monitor gave up.
    escalation: escalation(),
  };
}

/** The last escalation the monitor wrote, or null when it never had to escalate. */
function escalation() {
  const record = readJson(path.join(ROOT, 'runs/ruliad/monitor_escalation.json'));
  if (!record || !record.action) return null;
  const why = record.action.why || null;
  // An escalation is a snapshot of the gate at the moment it fired. Once the gate it named is clear,
  // showing it as a live alarm tells a reader to act on a condition that no longer holds, so the
  // record is kept and marked resolved instead of being hidden or silently repeated.
  const gateClaims = /proof gate requires: (.*)$/s.exec(why || '');
  let resolved = null;
  if (gateClaims && record.action.kind === 'escalate') {
    const { proofStatus } = require('./proof');
    const missing = proofStatus({
      heldout_report: readJson(path.join(ROOT, 'runs/ruliad/heldout_aggregate.json')) ||
        readJson(path.join(ROOT, 'runs/ruliad/heldout_report.json')) || null,
    }).missing_for_promotion;
    resolved = gateClaims[1].split('; ').every((claim) => !missing.includes(claim));
  }
  return { at: record.at || null, why, kind: record.action.kind || null, resolved };
}

module.exports = { GOAL, LADDER, SCHEMA, advance, firstOpen, prove, status };
