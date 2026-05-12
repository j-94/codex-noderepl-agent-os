'use strict';

const assert = require('assert');
const { bridge, byCapability } = require('../src/bridge');
const { K, init, readMem, run, step } = require('../src/core');
const { O } = require('../src/core');
const { builtins, choose, frontier, surface } = require('../src/surface');
const { gate, memexec, memfs, memgit, memnet } = require('../src/tools');

{
  const a = init();
  const b = step(a, memfs.write('a.txt', 'one'));
  assert.notStrictEqual(a, b);
  assert.strictEqual(readMem(a, 'a.txt'), null);
  assert.strictEqual(readMem(b, 'a.txt').value, 'one');
  assert.strictEqual(b.receipts.length, 1);
}

{
  const a = init();
  const b = run(a, [memfs.write('x', '1'), memfs.read('x')]);
  assert.strictEqual(b.effects.length, 1);
  assert.strictEqual(b.effects[0].kind, K.READ);
  assert.strictEqual(b.effects[0].data.value, '1');
}

{
  const a = init();
  const b = step(a, gate.effect(['fs.write', 'real.txt']));
  assert.strictEqual(b.halted, true);
  assert.strictEqual(b.mem.length, 0);
}

{
  const a = init();
  const b = step(a, memexec.plan(['npm', 'test']));
  assert.strictEqual(b.halted, false);
  assert.strictEqual(b.effects.length, 1);
}

{
  const a = init();
  const b = run(a, [
    memgit.stage(['src/core.js']),
    memgit.commit('virtual'),
    memnet.request({ method: 'GET', url: 'mem://example' }),
  ]);
  assert.strictEqual(b.effects.length, 3);
  assert.strictEqual(b.mem.length, 0);
  assert.strictEqual(b.halted, false);
}

{
  const a = run(init(), [
    memexec.plan(['npm', 'test']),
    memgit.stage(['src/core.js']),
  ]);
  const blocked = bridge(a);
  assert.strictEqual(blocked.results.every((result) => result.held), true);
  const admitted = bridge(a, byCapability(['argv']));
  assert.strictEqual(admitted.results[0].held, false);
  assert.strictEqual(admitted.results[1].held, true);
}

{
  const slow = surface([O.TRANSFORM], [5, 1, 1, 1, 5]);
  const fast = surface([O.TRANSFORM], [1, 1, 1, 1, 1]);
  assert.deepStrictEqual(frontier([slow, fast]), [fast]);
  assert.strictEqual(choose([slow, fast], O.TRANSFORM), fast);
  assert.strictEqual(Boolean(choose(builtins(), O.GATE)), true);
}

console.log('codex-tape selftest: ok');
