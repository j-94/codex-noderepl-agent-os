'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { hash } = require('./core');
const { runCodeDbFind } = require('./annealed_search');

const DEFAULT_WORKSPACE = path.resolve(__dirname, '..');

/**
 * Robustly find function or block boundaries for C-family syntax (JS, TS, Rust).
 * Tracks string quotes, template literals, line comments, block comments, and braces.
 */
function extractBraceBounds(lines, startLine) {
  let openBraces = 0;
  let started = false;
  let endLine = startLine;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    inLineComment = false; // resets each line

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      const prev = c > 0 ? line[c - 1] : '';
      const next = c + 1 < line.length ? line[c + 1] : '';

      // Skip escaped characters
      if (prev === '\\') continue;

      // Handle comments
      if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
        if (!inBlockComment && char === '/' && next === '/') {
          inLineComment = true;
          break; // rest of line is comment
        }
        if (!inBlockComment && char === '/' && next === '*') {
          inBlockComment = true;
          c++;
          continue;
        }
        if (inBlockComment && char === '*' && next === '/') {
          inBlockComment = false;
          c++;
          continue;
        }
      }

      if (inBlockComment || inLineComment) continue;

      // Handle strings
      if (char === "'" && !inDoubleQuote && !inTemplate) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (char === '"' && !inSingleQuote && !inTemplate) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inTemplate = !inTemplate;
        continue;
      }

      if (inSingleQuote || inDoubleQuote || inTemplate) continue;

      // Track braces and delimiters
      if (char === '{' || char === '[' || char === '(') {
        openBraces++;
        started = true;
      } else if (char === '}' || char === ']' || char === ')') {
        openBraces--;
      }
    }

    if (started && openBraces <= 0) {
      endLine = i + 1;
      break;
    }
  }

  return { startLine, endLine };
}

/**
 * Boundary extractor for Python indentation-based blocks.
 */
function extractPythonBounds(lines, startLine) {
  const defLine = lines[startLine - 1] || '';
  const match = defLine.match(/^(\s*)/);
  const baseIndent = match ? match[1].length : 0;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      endLine = i + 1;
      continue;
    }
    const currentIndent = line.match(/^(\s*)/)[1].length;
    if (currentIndent <= baseIndent) {
      break;
    }
    endLine = i + 1;
  }
  return { startLine, endLine };
}

/**
 * Locate a symbol's exact file and line bounds.
 */
function locateSymbol(symbol, explicitPath = null, workspace = DEFAULT_WORKSPACE) {
  const started = process.hrtime.bigint();
  let relPath = explicitPath;
  let startLine = 1;

  if (!relPath) {
    const findResult = runCodeDbFind(symbol, workspace);
    if (!findResult || !findResult.found || findResult.matches.length === 0) {
      return { found: false, error: `Symbol "${symbol}" not found by CodeDB` };
    }
    const match = findResult.matches[0];
    const parts = match.split(/\s+/);
    for (const p of parts) {
      if (p.includes(':')) {
        const [f, l] = p.split(':');
        relPath = f;
        startLine = parseInt(l, 10) || 1;
        break;
      }
    }
  }

  const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspace, relPath);
  if (!fs.existsSync(absPath)) {
    return { found: false, error: `File not found: ${absPath}` };
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');

  // If startLine wasn't found by CodeDB, scan for symbol signature
  if (startLine === 1) {
    const regex = new RegExp(`\\b(?:const|let|var|function|class|def)\\s+${symbol}\\b|\\b${symbol}\\s*[:=]`);
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        startLine = i + 1;
        break;
      }
    }
  }

  const ext = path.extname(absPath).toLowerCase();
  let bounds;
  if (ext === '.py') {
    bounds = extractPythonBounds(lines, startLine);
  } else {
    bounds = extractBraceBounds(lines, startLine);
  }

  const slice = lines.slice(bounds.startLine - 1, bounds.endLine).join('\n');
  const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;

  return {
    found: true,
    symbol,
    filePath: relPath,
    absolutePath: absPath,
    startLine: bounds.startLine,
    endLine: bounds.endLine,
    linesCount: bounds.endLine - bounds.startLine + 1,
    oldCode: slice,
    oldSha256: hash(slice),
    elapsed_ms,
  };
}

/**
 * Verify candidate code in-memory without writing to disk.
 */
function verifySyntax(candidateContent, fileExtension) {
  const started = process.hrtime.bigint();
  const ext = fileExtension.toLowerCase();

  try {
    if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
      new vm.Script(candidateContent, { filename: 'candidate.js' });
      return {
        valid: true,
        verifier: 'vm.Script',
        elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6,
      };
    } else if (ext === '.json') {
      JSON.parse(candidateContent);
      return {
        valid: true,
        verifier: 'JSON.parse',
        elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6,
      };
    } else if (ext === '.py') {
      const res = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: candidateContent,
        encoding: 'utf8',
        timeout: 2000,
      });
      if (res.status === 0) {
        return {
          valid: true,
          verifier: 'python3_ast',
          elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6,
        };
      } else {
        return {
          valid: false,
          verifier: 'python3_ast',
          error: res.stderr || 'Python syntax parse failed',
        };
      }
    }
    // Default pass for unsupported extensions
    return { valid: true, verifier: 'unsupported_extension_pass' };
  } catch (err) {
    return {
      valid: false,
      verifier: ext === '.json' ? 'JSON.parse' : 'vm.Script',
      error: err.message,
    };
  }
}

/**
 * Stage a mutation in memory and verify syntax.
 */
function stageMutation(symbol, replacementCode, { explicitPath = null, workspace = DEFAULT_WORKSPACE } = {}) {
  const locateResult = locateSymbol(symbol, explicitPath, workspace);
  if (!locateResult.found) {
    return { success: false, error: locateResult.error };
  }

  const absPath = locateResult.absolutePath;
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');

  // Splice replacement in memory
  const before = lines.slice(0, locateResult.startLine - 1);
  const after = lines.slice(locateResult.endLine);
  const candidateLines = [...before, replacementCode, ...after];
  const candidateContent = candidateLines.join('\n');

  const ext = path.extname(absPath);
  const syntaxCheck = verifySyntax(candidateContent, ext);
  if (!syntaxCheck.valid) {
    return {
      success: false,
      stage: 'syntax_verification',
      error: `Syntax error in candidate: ${syntaxCheck.error}`,
      verifier: syntaxCheck.verifier,
    };
  }

  return {
    success: true,
    symbol,
    filePath: locateResult.filePath,
    absolutePath: absPath,
    startLine: locateResult.startLine,
    endLine: locateResult.endLine,
    oldSlice: locateResult.oldCode,
    newSlice: replacementCode,
    candidateContent,
    oldSha256: locateResult.oldSha256,
    newSha256: hash(replacementCode),
    syntaxCheck,
  };
}

/**
 * Commit a verified staged mutation atomically to physical disk.
 */
function commitMutation(stagedResult, { runTest = false, testCommand = null, workspace = DEFAULT_WORKSPACE } = {}) {
  if (!stagedResult || !stagedResult.success) {
    throw new Error('Cannot commit invalid staged mutation: ' + (stagedResult?.error || 'unknown error'));
  }

  const started = process.hrtime.bigint();
  const absPath = stagedResult.absolutePath;
  const backupContent = fs.readFileSync(absPath, 'utf8');
  const tempPath = `${absPath}.${crypto.randomUUID()}.tmp`;

  // Atomic swap to candidate content
  fs.writeFileSync(tempPath, stagedResult.candidateContent, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(tempPath, absPath);

  // Optional pre-commit test execution with transactional rollback
  if (runTest && testCommand) {
    const res = spawnSync('/bin/sh', ['-c', testCommand], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (res.status !== 0) {
      // ROLLBACK: Restore original content immediately
      fs.writeFileSync(absPath, backupContent, { encoding: 'utf8', mode: 0o644 });
      return {
        success: false,
        stage: 'pre_commit_test_failed',
        error: `Test command failed with exit code ${res.status}`,
        stdout: res.stdout?.slice(0, 500),
        stderr: res.stderr?.slice(0, 500),
      };
    }
  }

  const finalSha256 = hash(stagedResult.candidateContent);
  const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;

  const receipt = {
    kind: 'agent_os.surgical_mutation.v1',
    timestamp: new Date().toISOString(),
    file: stagedResult.filePath,
    symbol: stagedResult.symbol,
    lines_replaced: [stagedResult.startLine, stagedResult.endLine],
    old_sha256: stagedResult.oldSha256,
    new_sha256: stagedResult.newSha256,
    final_file_sha256: finalSha256,
    elapsed_ms,
  };
  receipt.receipt_hash = hash(receipt);

  // Append receipt to persistent ledger
  try {
    const receiptPath = path.resolve(workspace, 'runs/ruliad/mutation_receipts.jsonl');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.appendFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  } catch {}

  return {
    success: true,
    receipt,
  };
}

module.exports = {
  extractBraceBounds,
  extractPythonBounds,
  locateSymbol,
  verifySyntax,
  stageMutation,
  commitMutation,
};
