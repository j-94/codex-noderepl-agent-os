'use strict';

const nodeRepl = require('repl');
const util = require('util');
const bridgeApi = require('./bridge');
const core = require('./core');
const surfaceApi = require('./surface');
const tools = require('./tools');
const { init, readMem, snapshot, step } = core;
const { gate, memexec, memfs } = tools;

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
    mem: state.mem.map(([key, blob]) => [key, { value: blob.value, hash: blob.hash }]),
    effects: state.effects.map((effect) => ({
      kind: effect.kind.description,
      data: effect.data,
    })),
    receipts: state.receipts.length,
  };
}

function start(input = process.stdin, output = process.stdout) {
  let machine = init();
  const server = nodeRepl.start({
    input,
    output,
    prompt: 'node-tape> ',
    useGlobal: false,
    writer: (value) => util.inspect(value, { colors: false, compact: false, depth: null }),
  });

  function apply(event) {
    machine = step(machine, event);
    server.context.machine = machine;
    server.context.M = machine;
    return view(machine);
  }

  Object.assign(server.context, {
    ...core,
    ...tools,
    ...bridgeApi,
    ...surfaceApi,
    apply,
    bridgeApi,
    core,
    read: (key) => readMem(machine, key),
    reset: () => {
      machine = init();
      server.context.machine = machine;
      server.context.M = machine;
      return view(machine);
    },
    snapshot: () => snapshot(machine),
    tools,
    view: () => view(machine),
  });

  server.context.machine = machine;
  server.context.M = machine;
  output.write('loaded: machine/M, apply(event), memfs, memexec, memgit, memnet, gate, bridge, surface\n');
  return server;
}

module.exports = {
  parse,
  readMem,
  start,
  view,
};
