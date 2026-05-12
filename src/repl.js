'use strict';

const readline = require('readline');
const { init, readMem, step } = require('./core');
const { gate, memexec, memfs } = require('./tools');

function parse(line) {
  const [command, key, ...rest] = line.trim().split(/\s+/);
  if (!command) return gate.tick();
  if (command === 'read') return memfs.read(key);
  if (command === 'write') return memfs.write(key, rest.join(' '));
  if (command === 'plan') return memexec.plan([key, ...rest].filter(Boolean));
  if (command === 'effect') return gate.effect([key, ...rest].filter(Boolean));
  if (command === 'admit') return gate.admit([key, ...rest].filter(Boolean));
  if (command === 'halt' || command === 'exit') return gate.halt();
  return memexec.plan([command, key, ...rest].filter(Boolean));
}

function view(state) {
  return {
    head: state.head,
    halted: state.halted,
    mem: state.mem.map(([key, blob]) => [key, blob.hash]),
    effects: state.effects.length,
    receipts: state.receipts.length,
  };
}

function start(input = process.stdin, output = process.stdout) {
  let machine = init();
  const rl = readline.createInterface({ input, output, prompt: 'tape> ' });
  rl.prompt();
  rl.on('line', (line) => {
    const event = parse(line);
    machine = step(machine, event);
    output.write(`${JSON.stringify(view(machine))}\n`);
    if (machine.halted) rl.close();
    else rl.prompt();
  });
  return rl;
}

module.exports = {
  parse,
  readMem,
  start,
  view,
};

