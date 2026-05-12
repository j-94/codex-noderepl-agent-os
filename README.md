# codex-tape

An immutable in-context machine for Codex.

`codex-tape` gives Codex a tiny machine it can run in chat, in a Node REPL, or
behind a VM. The core is a pure reducer. Live engines, model calls, files, git,
and network are capability surfaces outside the core.

```text
event -> step(machine, event) -> machine'
```

## Why The Layers Exist

| Layer | Why it exists | Metric |
| --- | --- | --- |
| Abstract machine | Fits in context and replays anywhere | deterministic replay |
| Symbol policy | Keeps meaning out of strings | no string route matching in core |
| Surface map | Chooses the lowest sufficient live engine | Pareto frontier over latency/evidence/safety/receipt/weight |
| MemFS | Makes file work virtual first | writes held before disk |
| Gate | Blocks real effects by default | unsafe effects = 0 in tests |
| Bridge | Admits selected virtual effects to a backend | blocked unless capability is allowed |
| Receipt | Makes every transition auditable | one receipt per step |
| Node REPL | Lets Codex run indefinitely | long-lived state without repo writes |

## Use

```bash
npm test
./agent-os selftest
./agent-os step write note.txt hello
./agent-os repl
```

Bridge pattern:

```js
const { bridge, byCapability } = require('./src/bridge');

bridge(machine, byCapability(['argv']), backend);
```

The bridge is the only place virtual effects can become backend calls.

Surface selection:

```js
const { O } = require('./src/core');
const { builtins, choose } = require('./src/surface');

const gate = choose(builtins(), O.GATE);
```

Real systems plug in as surfaces with metrics. The core does not know endpoint
names; it only sees supported operators and scores.

In Codex ICL, carry the machine like this:

```text
M = immutable state + tape + head + policy
For each event: apply step(M, event).
Use virtual tools first.
Halt before real effects unless admitted.
```

## Core Boundary

The core has no route prose, product doctrine, endpoint names, or hardcoded
workflow strings. Strings are edge data only: paths, bytes, and CLI commands.
Control lives in symbols, metrics, and pure transition functions.
