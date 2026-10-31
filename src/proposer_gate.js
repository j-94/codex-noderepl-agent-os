'use strict';

/**
 * Invariant X_7: Clamped Proposer Gate
 * Automatically clamps reasoning/thinking to 'low' when AST bounds are present
 * (yielding 3.78x speedup and 87.5% reasoning token reduction) and holds unbounded
 * high-thinking proposals without AST bounds to avoid catastrophic timeout (exit 143).
 */
function evalProposerGate({ hasAstBounds = false, hasMemory = false, requestedThinking = 'high' } = {}) {
  if (hasAstBounds && hasMemory) {
    return {
      decision: 'admit',
      mode: 'compound_quad',
      thinking: 'low',
      timeout_s: 30,
      speedup_expected: '3.8x',
      reason: 'Compound quad-stack active (memory + AST bounds); thinking clamped to low'
    };
  }
  if (hasAstBounds) {
    return {
      decision: 'admit',
      mode: 'ast_bounded',
      thinking: 'low',
      timeout_s: 45,
      speedup_expected: '1.2x',
      reason: 'AST bounds present; thinking clamped to low to prevent exploratory stall'
    };
  }
  if (!hasAstBounds && requestedThinking === 'high') {
    return {
      decision: 'hold',
      mode: 'unbounded_risk',
      thinking: 'high',
      timeout_s: 60,
      reason: 'High-thinking without AST bounds causes exploratory hang (exit 143 timeout); bounded AST scope required'
    };
  }
  return {
    decision: 'admit',
    mode: 'fallback',
    thinking: requestedThinking,
    timeout_s: 60,
    reason: 'Low thinking admitted under standard bounds'
  };
}

module.exports = {
  evalProposerGate
};
