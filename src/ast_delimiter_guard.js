'use strict';

function evalDelimiterGuard({ filepath, lineCount, isOverwrite, isArtifact = false, maxChurnLines = 60 }) {
  if (isArtifact) return { decision: 'admit', rule: 'X_2_exempt', reason: 'artifact_exempt' };
  if (isOverwrite && lineCount > maxChurnLines) {
    return { decision: 'hold', rule: 'X_2_violation', reason: `overwriting ${lineCount} lines exceeds threshold ${maxChurnLines}; use surgical AST replacement` };
  }
  return { decision: 'admit', rule: 'X_2_compliant', reason: 'bounded_surgical_edit' };
}

module.exports = { evalDelimiterGuard };
