'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createAdmission,
  runCommandWithAdmission,
  validateAdmission,
  writeFileWithAdmission,
} = require('../src/effect_proxy');

{
  assert.throws(
    () => createAdmission({ allowed_ops: ['fs.write'], allowed_paths: ['out/**'] }),
    /rollback, evidence, claim_boundary/,
  );
}

{
  const token = createAdmission({
    allowed_ops: ['fs.write'],
    allowed_paths: ['out/**'],
    rollback: 'delete written test file',
    evidence: ['unit test'],
    claim_boundary: 'temporary test write only',
    now: 0,
  });
  assert.strictEqual(token.kind, 'VMAdmission');
  assert.strictEqual(token.receipt_required, true);
  assert.strictEqual(token.admission_id.length, 24);
  assert.doesNotThrow(() => validateAdmission(token, { op: 'fs.write', target_path: 'out/file.txt', now: 1 }));
  assert.throws(() => validateAdmission(token, { op: 'run_command', now: 1 }), /operation not admitted/);
  assert.throws(() => validateAdmission(token, { op: 'fs.write', target_path: 'src/file.txt', now: 1 }), /path not admitted/);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-effect-proxy-'));
  const token = createAdmission({
    allowed_ops: ['fs.write'],
    allowed_paths: ['out/**'],
    rollback: 'remove temp directory',
    evidence: ['unit test temp dir'],
    claim_boundary: 'writes only inside temp out directory',
  });
  const receipt = writeFileWithAdmission(token, 'out/file.txt', 'hello', { cwd });
  assert.strictEqual(receipt.kind, 'effect_proxy.receipt.v0');
  assert.strictEqual(receipt.op, 'fs.write');
  assert.strictEqual(receipt.before_sha256, null);
  assert.strictEqual(fs.readFileSync(path.join(cwd, 'out/file.txt'), 'utf8'), 'hello');
}

{
  const token = createAdmission({
    allowed_ops: ['run_command'],
    allowed_paths: ['**'],
    rollback: 'no filesystem mutation',
    evidence: ['node process exits zero'],
    claim_boundary: 'command receipt test only',
  });
  const receipt = runCommandWithAdmission(token, [process.execPath, '-e', 'process.stdout.write("ok")']);
  assert.strictEqual(receipt.op, 'run_command');
  assert.strictEqual(receipt.status, 0);
  assert.strictEqual(receipt.stdout_sha256.length, 64);
}

console.log('effect proxy test: ok');
