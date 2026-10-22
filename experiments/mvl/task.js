'use strict';

// A disposable synthetic executable. The model cannot edit this file or its manifest.
// Admission/scope checks happen in the runner; compatibility is tested here.
const fs = require('node:fs');
const path = require('node:path');
const [manifestPath, tool] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (tool !== manifest.compatible_tool) {
  process.stdout.write(JSON.stringify({ exit_code: 3, error: 'incompatible executable' }));
  process.exitCode = 3;
} else {
  fs.writeFileSync(path.join(path.dirname(manifestPath), 'result.txt'), manifest.payload.toUpperCase());
  process.stdout.write(JSON.stringify({ exit_code: 0, artifact: 'result.txt' }));
}
