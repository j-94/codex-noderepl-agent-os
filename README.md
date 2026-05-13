# Agent OS v2

Agent OS v2 is a small language for running Codex work through an immutable
tape before anything reaches files, git, network, or shell.

The repo is the language. The core reducer is the tape machine. The v2 language
packet brings back the older Unity Kernel, MCK, VSM, psi-vector, BVT, hash,
prime, vector, tensor, UTIR, and receipt ideas as one compact object:

```text
intent
-> unity.kernel.packet.v0
-> tape event
-> gate
-> virtual effect or hold
-> receipt
```

Claim boundary: this is a production branch scaffold for the language and its
deterministic checks. It is not host-level mechanical enforcement until an
external effect proxy rejects unadmitted writes.

## Turing Machine Tape

A Turing machine has a tape, a head, an alphabet, and a transition function.
Agent OS keeps that idea, but makes it useful for agent work:

| Turing idea | Agent OS v2 |
| --- | --- |
| Tape | Ordered event history |
| Head | Current step number |
| Alphabet | Symbols like `READ`, `WRITE`, `PLAN`, `GATE`, `RECEIPT` |
| Transition function | `step(machine, event) -> machine'` |
| Work memory | Virtual MemFS cells |
| Halting | Stop before unsafe or complete effects |
| Proof | Hash-linked receipts |

```text
event -> step(machine, event) -> machine'
```

The point is not nostalgia for computation theory. The point is that a tape
forces every move to become inspectable state before the agent acts.

## The Language

The v2 packet is:

```json
{
  "kind": "unity.kernel.packet.v0",
  "intent": "operator goal",
  "psi": {
    "uncertainty": 0.0,
    "evidence_deficit": 0.0,
    "contradiction_pressure": 0.0,
    "budget": 1.0,
    "latency_pressure": 0.0,
    "novelty_demand": 0.5
  },
  "vsm": {"id": "S3", "role": "control"},
  "carrier": {
    "bitmask": 0,
    "prime_product": 1,
    "vector": [],
    "hash": "sha256"
  },
  "transition": {
    "S": "current state",
    "delta": "candidate change",
    "C": "control field",
    "S_prime": "next state if admitted"
  },
  "verb": "GATE",
  "gate": {
    "decision": "hold",
    "rollback": "",
    "claim_boundary": "",
    "receipt_required": true
  },
  "band": "u"
}
```

Short form:

```text
Psi state + VSM role + compact carrier + S + delta + C -> S'
```

## Lineage

| Old language | Reduced v2 role |
| --- | --- |
| Runes / op codes | Tiny stable alphabet |
| Psi notation | Control-state vector |
| MCK | Cognitive state update |
| Unity Kernel | Observe, plan, map, reduce, update, learn |
| VSM | S1 extraction, S2 routing, S3 control, S4 intelligence, S5 policy |
| Hashes | Stable content identity |
| Primes | Compact lineage identity from active bits |
| Vectors | Numeric control state |
| Tensors | Learned route/control field |
| BVT | Admission law: `S + delta + C -> S'` |
| UTIR | Executable op tape after admission |
| Receipts | Replayable memory and proof |

## Metrics

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
| Unity packet | Carries the old language stack without doctrine sprawl | one packet has psi, VSM, carrier, transition, gate |
| Prime carrier | Compresses active control bits | stable prime product for same bitmask |
| BVT band | Prevents premature permanence | `u -> f1 -> f2 -> f3 -> inf` |

Current deterministic checks:

```text
core tape selftest
turn-0 reflex memory test
BVT cybernetic tape test
Unity language test
```

## Quickstart

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

Create a v2 packet:

```js
const { unityPacket } = require('./src/language');

unityPacket({
  intent: 'build a feature without direct writes',
  state: 'request is still prose',
  delta: 'typed op tape candidate',
  constraint: 'rollback plus receipt required',
  next_state: 'held until admitted',
});
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

## Codex Cloud

Use the same contract in Codex Cloud:

```text
1. Start from a branch, not main.
2. Ask Codex to emit `unity.kernel.packet.v0` before edits.
3. Keep generated work virtual until the packet has rollback, evidence, and a
   claim boundary.
4. Convert admitted work into a patch or UTIR op tape.
5. Run `npm test`.
6. Attach the test output and branch diff as the receipt.
```

Minimal Codex Cloud prompt:

```text
Use Agent OS v2. Before editing, compile my request into
unity.kernel.packet.v0 with psi, VSM role, carrier, transition, gate,
rollback, evidence, and claim boundary. Treat files as backend effects only
after the gate. Run npm test and summarize the receipt.
```

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

The v2 language module is deliberately outside the reducer. It describes and
compresses control state; the reducer still only executes symbols.
