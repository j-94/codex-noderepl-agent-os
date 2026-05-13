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

`./agent-os repl` is a native Node REPL with the machine already loaded:

```js
apply(memfs.write('intent', 'stay in the REPL'))
apply(memexec.plan(['npm', 'test']))
view()
bridge(machine)
```

The REPL process carries `machine`/`M` forward until you exit it. This is the
primary live surface; the CLI parser is only a thin one-shot edge.

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

## Agent OS Capability First

For benchmarks, hillclimbs, capability consumption, quick proof harnesses, and
Agent OS validation, start with the native REPL before heavier external
programs:

```text
./agent-os repl
-> builtins() / surface(...) / choose(...)
-> memfs packet
-> memexec planned effect
-> gate / bridge
-> view() / read(key) receipt
-> hold unless admitted
```

Use BVT runners, `growing-api-core`, shell-only scripts, broad repo scans, or
live Codex execution only when the Agent OS packet says the missing evidence
requires them. The REPL is the quick control carrier; other programs are
sensors, scorers, or admitted backends.

Carry anchors from the first quick benchmark smoke:

```text
bench:smoke:v0 hash =
6b2fdfe42e015a4d8badbf1b9c63012bdac10b308248ce72cadee11e6d21cd14

bench:run:fast-virtual:v0 hash =
cd24e439e0f5b145d32a522acb8c6da430e241ec46ee75ab43b91ac9ad18eb93
```

Claim boundary: these packets prove representation, route selection, gating,
and receipt shape for the smoke. They do not prove live LM quality, SWE-bench
lift, production safety, or host-level mechanical enforcement.

## UTIR-Gated Materialization

Files, tests, shell commands, and git operations are allowed, but only as the
final backend of a typed control path:

```text
intent
-> Agent OS REPL or TP(...)
-> WorkManifest / ControlPacket
-> UTIR-style op tape
-> gate: rollback + evidence + claim_boundary + path/tool scope
-> admission / receipt preview
-> scoped backend materialization
-> persisted receipt
```

Forbidden path:

```text
chat intent
-> decide files are useful
-> apply_patch / shell write / git command
```

Required path:

```text
chat intent
-> REPL/TP packet
-> typed op tape
-> gate and receipt preview
-> scoped backend materialization
```

Until a mechanical effect proxy exists, this is a protocol-level operating
contract. The bridge remains the runtime boundary for turning virtual effects
into backend calls.

## Hillclimbing Prompt

Use this prompt when comparing LM generation with Agent OS control overhead:

```text
Use the built-in Agent OS Node REPL, `./agent-os repl`, to hillclimb LM +
machine control overhead. Run the benchmark inside the live REPL with the
preloaded bindings: machine/M, apply(event), memfs, memexec, gate, builtins,
choose, O, init, and run.

Start from token-level events plus full snapshot receipts, then search toward
chunk-level and generation-level control, snapshot versus delta/Merkle receipts,
and repeated versus single route selection.

Measure events per generation, overhead per generation, total runtime, receipt
tail/hash, and whether effects stay virtual/held.

Prefer:
intent packet -> one route selection -> one bounded LM generation -> one gate
-> one delta receipt -> admit or hold effect.
```

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
