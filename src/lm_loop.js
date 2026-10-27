'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { hash } = require('./core');
const { evalProposerGate } = require('./proposer_gate');
const { AntiRecursionTripwire, TRIPWIRE_STATUS } = require('./anti_recursion');
const { evalHeadless } = require('./headless_eval');
const surgical = require('./surgical_mutation');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'lm-config.json');
const TAPE_PATH = path.join(PROJECT_ROOT, 'runs', 'ruliad', 'daemon_tape.jsonl');
const PI_BIN = '/opt/homebrew/bin/pi';

function loadLmConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {}
  }
  return {
    default_profile: 'quad_stack',
    profiles: {
      quad_stack: { provider: 'xai', model: 'grok-4.7', thinking: 'low', timeout_s: 30 },
      fast: { provider: 'xai', model: 'grok-4.7', thinking: 'low', timeout_s: 15 },
      reasoning: { provider: 'xai', model: 'grok-4.7', thinking: 'high', timeout_s: 60 }
    }
  };
}

function appendTapeRecord(record) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record
  }) + '\n';
  try {
    fs.mkdirSync(path.dirname(TAPE_PATH), { recursive: true });
    fs.appendFileSync(TAPE_PATH, line, 'utf8');
  } catch {}
}

/**
 * Meta-Loop Engine (LM Loop)
 * Orchestrates: Policy Config -> Context Packet -> Clamped Proposer -> AST Mutation -> Physical Witness -> Tape Commit
 */
async function runLmLoop({
  goal,
  profileName = null,
  targetFile = null,
  targetSymbol = null,
  testCommand = null,
  maxIterations = 3,
  mockProposer = null // for deterministic testing
} = {}) {
  const t0 = process.hrtime.bigint();
  const lmConfig = loadLmConfig();
  const activeProfileKey = profileName || lmConfig.default_profile || 'quad_stack';
  const profile = lmConfig.profiles[activeProfileKey] || lmConfig.profiles.quad_stack;

  const tripwire = new AntiRecursionTripwire({ maxDepth: 1, statePath: null });
  const trajectory = [];
  let isSuccess = false;
  let finalWitness = null;
  let lastError = null;

  // 1. AST Bounds pre-flight
  let astBounds = null;
  if (targetFile && targetSymbol && fs.existsSync(targetFile)) {
    try {
      astBounds = surgical.locateSymbol(targetSymbol, targetFile, PROJECT_ROOT);
    } catch {}
  }

  // 2. Proposer Gate (Invariant X_7)
  const gateDecision = evalProposerGate({
    hasAstBounds: Boolean(astBounds && astBounds.found),
    hasMemory: true,
    requestedThinking: profile.thinking || 'low'
  });

  if (gateDecision.decision === 'hold') {
    appendTapeRecord({
      kind: 'agent_os.lm_loop_proposer_hold.v1',
      goal,
      reason: gateDecision.reason
    });
    return {
      success: false,
      held: true,
      reason: gateDecision.reason
    };
  }

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const iterT0 = process.hrtime.bigint();

    // Invariant X_10: Anti-Recursion Tripwire check
    const wireDecision = tripwire.evaluate({
      goal,
      depth: iteration,
      action: { iteration, targetFile, targetSymbol },
      physicalWitness: finalWitness || lastError || 'initial'
    });

    if (wireDecision.decision === TRIPWIRE_STATUS.TRIPWIRE_HOLD) {
      appendTapeRecord({
        kind: 'agent_os.lm_loop_tripwire_hold.v1',
        iteration,
        goal,
        reason: wireDecision.reason
      });
      return {
        success: false,
        tripped: true,
        iterations: iteration,
        reason: wireDecision.reason,
        trajectory
      };
    }

    // 3. Prompt Construction
    const promptParts = [
      `[TASK]: ${goal}`,
      `[PROFILE]: ${activeProfileKey} (${profile.model}) | Thinking: ${gateDecision.thinking}`,
      astBounds?.found ? `[AST BOUNDS]: Symbol "${targetSymbol}" in ${targetFile} (lines ${astBounds.startLine}-${astBounds.endLine})` : null,
      astBounds?.oldCode ? `[CURRENT CODE TO FIX]:\n\`\`\`javascript\n${astBounds.oldCode}\n\`\`\`` : null,
      lastError ? `[PRIOR FAILURE WITNESS]:\n${lastError}` : null,
      `OUTPUT FORMAT REQUIREMENT: Respond with ONLY the complete updated JavaScript function definition inside a \`\`\`javascript code block. Zero conversational preamble or prose.`
    ].filter(Boolean).join('\n\n');

    // 4. Proposer Call (Pi or Mock)
    let proposal = '';
    if (mockProposer) {
      proposal = await mockProposer({ prompt: promptParts, iteration });
    } else if (fs.existsSync(PI_BIN)) {
      const piArgs = [
        '-a', '-nt',
        '--thinking', gateDecision.thinking,
        '-p', promptParts
      ];
      const p = spawnSync(PI_BIN, piArgs, {
        encoding: 'utf8',
        timeout: (profile.timeout_s || 30) * 1000
      });
      proposal = (p.stdout || '').trim();
    } else {
      proposal = '// Fallback proposal (Pi not mounted)';
    }

    function extractCode(raw) {
      if (!raw) return '';
      const match = raw.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
      return match ? match[1].trim() : raw.trim();
    }
    const cleanProposal = extractCode(proposal);

    // 5. Physical Execution & Witness Gating
    let executionResult = null;
    let witnessHash = null;

    if (targetSymbol && targetFile && fs.existsSync(targetFile)) {
      // Real-World AST Surgical Code Mutation (Invariant X_2)
      const staged = surgical.stageMutation(targetSymbol, cleanProposal, {
        explicitPath: targetFile,
        workspace: PROJECT_ROOT
      });

      if (!staged.success) {
        lastError = `AST Stage Error: ${staged.error}`;
        witnessHash = hash({ error: lastError });
        finalWitness = { error: lastError };
      } else {
        const commitRes = surgical.commitMutation(staged, {
          runTest: Boolean(testCommand),
          testCommand,
          workspace: PROJECT_ROOT
        });

        if (commitRes.success) {
          isSuccess = true;
          witnessHash = hash(commitRes.receipt);
          finalWitness = { success: true, receipt: commitRes.receipt };
          executionResult = commitRes.receipt;
        } else {
          lastError = commitRes.stderr || commitRes.stdout || commitRes.error || 'Pre-commit test failed';
          witnessHash = hash({ error: lastError });
          finalWitness = { exitCode: 1, error: lastError };
          executionResult = { error: lastError };
        }
      }
    } else if (testCommand) {
      const run = spawnSync('sh', ['-c', testCommand], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 15000
      });
      const exitCode = run.status;
      const stdout = (run.stdout || '').trim();
      const stderr = (run.stderr || '').trim();
      witnessHash = hash({ exitCode, stderr: stderr.slice(-300) });
      finalWitness = { exitCode, stdout: stdout.slice(-200), stderr: stderr.slice(-200) };

      if (exitCode === 0) {
        isSuccess = true;
      } else {
        lastError = stderr || stdout || `Command exited with code ${exitCode}`;
      }
      executionResult = { exitCode, stdoutSnippet: stdout.slice(-100), stderrSnippet: stderr.slice(-100) };
    } else {
      // Direct tape state execution via evalHeadless
      const evalRes = evalHeadless({
        code: `(() => { apply({ kind: K.PLAN, data: ${JSON.stringify(cleanProposal.slice(0, 200))} }); return true; })()`
      });
      isSuccess = evalRes.receipt.success;
      witnessHash = evalRes.receipt.source_sha256;
      finalWitness = { head: evalRes.view.head, success: isSuccess };
      executionResult = evalRes.view;
    }

    const iterElapsed = Number(process.hrtime.bigint() - iterT0) / 1e6;
    const stepRecord = {
      iteration,
      proposalSnippet: proposal.slice(0, 150),
      witnessHash,
      isSuccess,
      elapsed_ms: iterElapsed
    };
    trajectory.push(stepRecord);

    appendTapeRecord({
      kind: 'agent_os.lm_loop_step.v1',
      goal,
      iteration,
      profile: activeProfileKey,
      thinking: gateDecision.thinking,
      isSuccess,
      witnessHash
    });

    if (isSuccess) break;
  }

  const totalElapsed = Number(process.hrtime.bigint() - t0) / 1e6;
  const receipt = {
    kind: 'agent_os.lm_loop_receipt.v1',
    id: `lm-loop-${crypto.randomUUID()}`,
    goal,
    profile: activeProfileKey,
    iterations_used: trajectory.length,
    success: isSuccess,
    total_elapsed_ms: totalElapsed,
    timestamp: new Date().toISOString()
  };

  appendTapeRecord(receipt);

  return {
    success: isSuccess,
    receipt,
    trajectory,
    total_elapsed_ms: totalElapsed
  };
}

module.exports = {
  loadLmConfig,
  runLmLoop
};
