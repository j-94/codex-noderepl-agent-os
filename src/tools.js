'use strict';

const { K, op } = require('./core');

const memfs = Object.freeze({
  read: (key) => op(K.READ, { key }),
  write: (key, value) => op(K.WRITE, { key, value }),
});

const memexec = Object.freeze({
  plan: (argv) => op(K.PLAN, { argv: Object.freeze([...argv]) }),
});

const memgit = Object.freeze({
  stage: (paths) => op(K.PLAN, { git: Object.freeze(['stage', ...paths]) }),
  commit: (message) => op(K.PLAN, { git: Object.freeze(['commit', message]) }),
});

const memnet = Object.freeze({
  request: (request) => op(K.PLAN, { net: Object.freeze({ ...request }) }),
});

const gate = Object.freeze({
  admit: (capability) => op(K.ADMIT, { capability }),
  effect: (capability) => op(K.EFFECT, { capability }),
  halt: () => op(K.HALT),
  tick: () => op(K.TICK),
});

module.exports = {
  gate,
  memexec,
  memfs,
  memgit,
  memnet,
};
