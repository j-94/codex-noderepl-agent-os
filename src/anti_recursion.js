'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hash } = require('./core');

const DEFAULT_TRIPWIRE_STATE = path.join(__dirname, '..', 'runs', 'ruliad', 'tripwire_state.json');

const TRIPWIRE_STATUS = {
  ADMIT: 'ADMIT',
  TRIPWIRE_HOLD: 'TRIPWIRE_HOLD',
  RESET: 'RESET'
};

/**
 * Invariant X_10: Anti-Recursion Physical Tripwire
 * Forbids metacognitive regression loops:
 * Allow(action) <=> Depth <= maxDepth OR ΔPhysicalWitness > 0
 */
class AntiRecursionTripwire {
  constructor({ maxDepth = 1, statePath = DEFAULT_TRIPWIRE_STATE, strictMode = true } = {}) {
    this.maxDepth = maxDepth;
    this.statePath = statePath;
    this.strictMode = strictMode;
    this.currentDepth = 0;
    this.lastWitnessHash = null;
    this.tripCount = 0;
    this.transitions = [];

    if (this.statePath && fs.existsSync(this.statePath)) {
      try {
        const persisted = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        this.lastWitnessHash = persisted.lastWitnessHash || null;
        this.tripCount = persisted.tripCount || 0;
      } catch {}
    }
  }

  _persist() {
    if (!this.statePath) return;
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify({
        lastWitnessHash: this.lastWitnessHash,
        tripCount: this.tripCount,
        updatedAt: new Date().toISOString()
      }, null, 2) + '\n', 'utf8');
    } catch {}
  }

  /**
   * Evaluates whether an incoming action or retry is admitted
   * or trips the anti-recursion breaker.
   */
  evaluate({ goal, action, depth = 1, physicalWitness = null }) {
    const witnessHash = physicalWitness !== null && physicalWitness !== undefined
      ? (typeof physicalWitness === 'string' ? hash({ raw: physicalWitness }) : hash(physicalWitness))
      : null;

    // Check if state changed since last step
    const deltaWitness = this.lastWitnessHash !== null && witnessHash !== null
      ? this.lastWitnessHash !== witnessHash
      : (depth <= this.maxDepth);

    // Evaluate recursion condition
    if (depth > this.maxDepth) {
      if (!deltaWitness) {
        // Zero physical delta + depth exceeded = recursive goodharting/retry loop!
        this.tripCount++;
        this._persist();
        const record = {
          decision: TRIPWIRE_STATUS.TRIPWIRE_HOLD,
          depth,
          maxDepth: this.maxDepth,
          goal,
          action_kind: action?.kind || typeof action,
          witnessHash,
          reason: `TRIPWIRE_HOLD: Recursion depth ${depth} > ${this.maxDepth} with zero physical state progress (ΔWitness = 0)`,
          timestamp: new Date().toISOString()
        };
        this.transitions.push(record);
        return record;
      }

      // Physical progress occurred despite depth; collapse stack to depth 1
      this.currentDepth = 1;
      this.lastWitnessHash = witnessHash;
      this._persist();
      const record = {
        decision: TRIPWIRE_STATUS.ADMIT,
        depth: 1,
        collapsedFrom: depth,
        goal,
        action_kind: action?.kind || typeof action,
        witnessHash,
        reason: `ADMIT: Physical witness progressed (ΔWitness > 0); recursion stack collapsed to depth 1`,
        timestamp: new Date().toISOString()
      };
      this.transitions.push(record);
      return record;
    }

    // Standard bounded horizon (depth <= maxDepth)
    this.currentDepth = depth;
    if (witnessHash !== null) {
      this.lastWitnessHash = witnessHash;
      this._persist();
    }
    const record = {
      decision: TRIPWIRE_STATUS.ADMIT,
      depth,
      goal,
      action_kind: action?.kind || typeof action,
      witnessHash,
      reason: `ADMIT: Operation within bounded recursion horizon (depth ${depth} <= ${this.maxDepth})`,
      timestamp: new Date().toISOString()
    };
    this.transitions.push(record);
    return record;
  }

  reset() {
    this.currentDepth = 0;
    this.lastWitnessHash = null;
    this.tripCount = 0;
    this.transitions = [];
    if (this.statePath && fs.existsSync(this.statePath)) {
      try { fs.unlinkSync(this.statePath); } catch {}
    }
  }
}

/**
 * Markovian Queue Flattener
 * Flattens any nested recursive action tree into a linear stream of Depth-1 operations.
 */
function flattenCallTree(node, parentId = null, flatList = []) {
  if (!node) return flatList;

  const currentId = node.id || `op-${flatList.length}-${crypto.randomBytes(4).toString('hex')}`;
  const flatItem = {
    id: currentId,
    parentId,
    depth: 1, // Normalized to flat depth 1
    type: node.type || node.kind || 'ACTION',
    payload: node.payload || node.data || null
  };
  flatList.push(flatItem);

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      flattenCallTree(child, currentId, flatList);
    }
  }

  return flatList;
}

module.exports = {
  TRIPWIRE_STATUS,
  AntiRecursionTripwire,
  createAntiRecursionTripwire: (opts) => new AntiRecursionTripwire(opts),
  flattenCallTree
};
