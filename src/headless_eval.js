'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const core = require('./core');
const tools = require('./tools');
const bridgeApi = require('./bridge');
const effectProxyApi = require('./effect_proxy');
const transitionApi = require('./ruliad_transition');
const programApi = require('./transition_program');
const surgicalMutation = require('./surgical_mutation');
const { evalProposerGate } = require('./proposer_gate');
const { AntiRecursionTripwire, flattenCallTree } = require('./anti_recursion');

const DEFAULT_STATE_PATH = path.resolve(__dirname, '../runs/ruliad/machine_state.json');
const DEFAULT_TAPE_PATH = path.resolve(__dirname, '../runs/ruliad/daemon_tape.jsonl');

function appendToTape(record, tapePath = DEFAULT_TAPE_PATH) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record
  }) + '\n';
  try {
    fs.mkdirSync(path.dirname(tapePath), { recursive: true });
    fs.appendFileSync(tapePath, line, 'utf8');
  } catch {}
}

function viewMachine(m) {
  return {
    head: m.head,
    halted: m.halted,
    mem_keys: m.mem.map(([k]) => k),
    effects_count: m.effects ? m.effects.length : 0,
    receipts_count: m.receipts ? m.receipts.length : 0
  };
}

/**
 * Headless Code-Mode Tape Evaluator
 * Runs expressive JavaScript batches against the persistent state machine
 * and records every atomic transition on the Agent OS Tape.
 */
function evalHeadless({ code, scriptPath, statePath = DEFAULT_STATE_PATH, tapePath = DEFAULT_TAPE_PATH } = {}) {
  // 1. Load or initialize machine state
  let machine;
  if (fs.existsSync(statePath)) {
    try {
      machine = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (typeof machine.policy !== 'function') {
        machine.policy = core.defaultPolicy;
      }
    } catch {
      machine = core.init();
    }
  } else {
    machine = core.init();
  }

  const operationsLogged = [];
  const sandbox = {
    ...core,
    ...tools,
    ...bridgeApi,
    ...effectProxyApi,
    transitionApi,
    programApi,
    surgicalMutation,
    evalProposerGate,
    viewMachine,
    AntiRecursionTripwire,
    flattenCallTree,
    machine,
    M: machine,
    apply: null,
    console,
    Buffer,
    process: {
      env: process.env,
      cwd: process.cwd,
      hrtime: process.hrtime
    },
    setTimeout,
    clearTimeout
  };

  const tripwire = new AntiRecursionTripwire({ maxDepth: 1, statePath: null });

  function apply(event) {
    if (!event) return viewMachine(machine);

    // If event is a nested plan or has children, flatten into Depth-1 queue
    if (Array.isArray(event.children) || Array.isArray(event.subtasks)) {
      const flattened = flattenCallTree(event);
      for (const item of flattened) {
        const wireDecision = tripwire.evaluate({
          goal: item.type,
          depth: item.depth,
          action: item,
          physicalWitness: viewMachine(machine)
        });
        if (wireDecision.decision === 'TRIPWIRE_HOLD') {
          appendToTape({
            kind: 'agent_os.tripwire_held.v1',
            head: machine.head,
            reason: wireDecision.reason,
            item
          }, tapePath);
          throw new Error(wireDecision.reason);
        }

        const subEvent = {
          kind: core.K[item.type] || item.type,
          data: item.payload
        };
        machine = core.step(machine, subEvent);
        operationsLogged.push(subEvent);
        appendToTape({
          kind: 'agent_os.tape_step.v1',
          head: machine.head,
          depth: 1,
          parentId: item.parentId,
          event_kind: subEvent?.kind?.description || String(subEvent?.kind),
          data: subEvent?.data,
          effects_count: machine.effects ? machine.effects.length : 0,
          receipts_count: machine.receipts ? machine.receipts.length : 0
        }, tapePath);
      }
      sandbox.machine = machine;
      sandbox.M = machine;
      return viewMachine(machine);
    }

    const wireDecision = tripwire.evaluate({
      goal: event?.kind?.description || String(event?.kind),
      depth: event?.depth || 1,
      action: event,
      physicalWitness: viewMachine(machine)
    });
    if (wireDecision.decision === 'TRIPWIRE_HOLD') {
      appendToTape({
        kind: 'agent_os.tripwire_held.v1',
        head: machine.head,
        reason: wireDecision.reason,
        event
      }, tapePath);
      throw new Error(wireDecision.reason);
    }

    machine = core.step(machine, event);
    sandbox.machine = machine;
    sandbox.M = machine;
    operationsLogged.push(event);
    appendToTape({
      kind: 'agent_os.tape_step.v1',
      head: machine.head,
      depth: 1,
      event_kind: event?.kind?.description || String(event?.kind),
      data: event?.data,
      effects_count: machine.effects ? machine.effects.length : 0,
      receipts_count: machine.receipts ? machine.receipts.length : 0
    }, tapePath);
    return viewMachine(machine);
  }
  sandbox.apply = apply;

  let source = code;
  if (!source && scriptPath) {
    source = fs.readFileSync(scriptPath, 'utf8');
  }
  if (!source || typeof source !== 'string') {
    throw new Error('evalHeadless requires <code> or <scriptPath>');
  }

  let executableSource = source.trim();
  if (/\breturn\b/.test(executableSource) && !executableSource.startsWith('(function') && !executableSource.startsWith('(() =>') && !executableSource.startsWith('(async')) {
    executableSource = `(() => {\n${executableSource}\n})()`;
  }

  const context = vm.createContext(sandbox);
  const t0 = performance.now();
  let result;
  let evalError = null;

  try {
    result = vm.runInContext(executableSource, context, { timeout: 20000 });
  } catch (err) {
    evalError = err.message;
  }
  const elapsed_ms = performance.now() - t0;

  // Persist updated machine state if execution was clean
  if (!evalError) {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(machine, null, 2), 'utf8');
    } catch {}
  }

  // Record summary cell to daemon_tape
  const receipt = {
    kind: 'agent_os.headless_eval_receipt.v1',
    eval_id: 'eval-' + crypto.randomUUID().slice(0, 12),
    source_sha256: crypto.createHash('sha256').update(source).digest('hex'),
    operations_count: operationsLogged.length,
    elapsed_ms: Number(elapsed_ms.toFixed(3)),
    success: !evalError,
    error: evalError,
    post_state: viewMachine(machine)
  };

  appendToTape(receipt, tapePath);

  return {
    receipt,
    result,
    view: viewMachine(machine),
    operations_count: operationsLogged.length
  };
}

module.exports = {
  evalHeadless,
  appendToTape,
  viewMachine,
  DEFAULT_STATE_PATH,
  DEFAULT_TAPE_PATH
};
