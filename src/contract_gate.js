'use strict';

/**
 * Invariant X_11: Pre-Turn Contract Gate
 * Invariant X_12: Non-Zero State Delta Gate
 *
 * Ensures all mutating operations declare explicit teleological intent and physical
 * verification witness criteria before execution, and prevents ghost/empty completions.
 */
function evalContractGate({
  isMutating = false,
  teleologicalIntent = null,
  witnessCriteria = null,
  stateDelta = 0,
  isTurnComplete = false,
} = {}) {
  // Invariant X_11: Mutating actions require explicit pre-flight intent and witness criteria
  if (isMutating) {
    if (!teleologicalIntent || typeof teleologicalIntent !== 'string' || teleologicalIntent.trim().length < 5) {
      return {
        decision: 'hold',
        rule: 'X_11_violation',
        reason: 'CONTRACT_HOLD: Mutating action attempted without explicit teleological intent declaration.'
      };
    }
    if (!witnessCriteria || typeof witnessCriteria !== 'string' || witnessCriteria.trim().length < 3) {
      return {
        decision: 'hold',
        rule: 'X_11_violation',
        reason: 'CONTRACT_HOLD: Mutating action attempted without declared physical witness criteria (e.g. test command or exit code).'
      };
    }
    return {
      decision: 'admit',
      rule: 'X_11_compliant',
      reason: 'Mutating contract satisfied with bounded intent and physical witness target.'
    };
  }

  // Invariant X_12: Turn completion requires non-zero physical state or witness delta
  if (isTurnComplete) {
    if (stateDelta <= 0) {
      return {
        decision: 'hold',
        rule: 'X_12_violation',
        reason: 'ZERO_DELTA_HOLD: Turn claimed complete without producing any physical disk, tape, or ledger delta.'
      };
    }
    return {
      decision: 'admit',
      rule: 'X_12_compliant',
      reason: 'Turn completion admitted with verified non-zero state delta.'
    };
  }

  // Read-only or intermediate inspection actions pass through
  return {
    decision: 'admit',
    rule: 'read_only_pass',
    reason: 'Non-mutating read-only inspection admitted.'
  };
}

module.exports = {
  evalContractGate
};
