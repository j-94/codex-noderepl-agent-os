# AGENTS

Scope: this project.

## Session Entry: Already Bootstrapped

For this workspace, the canonical start state is this file's in-memory
Transition Proxy contract. Do not re-run the full recovery/harness ritual just
to answer "what state are we in", "how should you operate", or adjacent control
questions.

Default short-circuit:

```text
fresh session / control question
-> read this project AGENTS state as recovered state
-> TP(intent, recovered_state?, op?, gate?)
-> compact answer-card or ControlPacket
-> no repo scan, harness replay, or global front-door expansion unless asked
```

Use prior chats, `history-merge-distiller`, global AGENTS, and exact session
handles only as sensors when the user asks for evidence, contradiction
resolution, durable mutation, or a specific prior-work lookup.

## Primitive Atlas Gate

For any Codex-control, memory, prior-work, agent-behavior, filesystem-control,
generation-control, or failure-mode question, route through the local Primitive
Atlas before prose, tools, repo reads, or effects.

Active atlas:

```text
/Users/jobs/Documents/New project/docs/PRIMITIVE_ATLAS.md
/Users/jobs/Documents/New project/data/primitive-atlas.v0.json
```

Default pre-action loop:

```text
intent
-> distinguish the active boundary
-> allocate scarce attention/tool/budget
-> packetize current move
-> route by purpose
-> gate before effect
-> act or hold
-> receipt
-> promote only if repeated
```

Natural control check:

```text
Before acting, ask:
1. Am I retrieving when assimilation is the needed move?
2. Am I using files, tools, or repos as controller instead of sensors/backends?
3. Am I about to mutate without packet, rollback, evidence, and claim boundary?
4. Am I expanding new machinery when an existing primitive/surface handles it?
5. Am I making a claim without receipt-backed evidence?
```

If any answer is yes, return `hold`, repair the packet, or downgrade to a
read-only answer-card. This is a protocol-level gate: it reduces failure modes
by changing the active operating representation, but it is not mechanical
enforcement until an external effect proxy blocks unadmitted tools.

## Agent OS v2 Unity Language

Active production branch:

```text
codex/agent-os-v2-unity-language
```

For Agent OS runtime, control-language, Codex Cloud, filesystem-control, or
v2/product work in this repo, use the v2 language packet before prose, tools, or
effects:

```text
intent
-> unity.kernel.packet.v0
-> Agent OS tape event
-> gate
-> virtual effect or hold
-> receipt
```

The repo itself is the language. Keep mechanics in the reducer and control
meaning in `unity.kernel.packet.v0`.

Default packet:

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
  "vsm": {"id": "S1|S2|S3|S4|S5", "role": "extraction|routing|control|intelligence|policy"},
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
  "verb": "OBSERVE|SELECT|TRANSFORM|GATE|COMMIT|RECEIPT",
  "gate": {
    "decision": "hold|shadow|admit|reject",
    "rollback": "",
    "claim_boundary": "",
    "receipt_required": true
  },
  "band": "u|f1|f2|f3|inf"
}
```

Lineage reduction:

```text
runes/op-codes -> stable alphabet
psi notation -> control-state vector
MCK -> cognitive state update
Unity Kernel -> observe/plan/map/reduce/update/learn
VSM -> S1 extraction, S2 routing, S3 control, S4 intelligence, S5 policy
hashes/primes/vectors/tensors -> compact carrier and route identity
BVT -> S + delta + C -> S'
UTIR -> admitted executable op tape
receipts -> replayable memory
```

Fresh-session operating rule:

```text
Think: unity.kernel.packet.v0
Act: Agent OS tape first
Materialize: only after rollback + evidence + claim_boundary + receipt
```

Codex Cloud instruction:

```text
Before editing, compile the request into unity.kernel.packet.v0 with psi, VSM
role, carrier, transition, gate, rollback, evidence, and claim boundary. Treat
files as backend effects only after the gate. Run npm test and summarize the
receipt.
```

Claim boundary: this is repo-level protocol and branch instruction. It improves
session alignment and deterministic testing, but it is not mechanical effect
sealing until an external proxy rejects unadmitted writes.

## Broad History Startup Adapter

When a fresh session needs to reason over prior Codex work, agent-improvement
state, robustness gaps, or "last N threads" style evidence, use the existing
History Merge Distiller surface before narrow local session scans or raw history
search.

Primary broad-history engine:

```text
/Users/jobs/Desktop/history-merge-distiller
```

Known state:

```text
product: turns old agent/chat work into explicit merge queues, receipts, and promotion decisions
coverage: 1,435 Codex sessions observed, 28,621 prompt packet rows, 1,510+ searchable viewer records
state: f3_candidate_pending_gate
lanes: root_contract, memory_runtime, retrieval_policy, claim_admission_runtime
evidence: 12 / 12 handles located and reviewed in the f3 rebuild
claim boundary: gate-ready canary, not production self-improvement or lossless memory
```

Default route for broad memory / improvement questions:

```text
intent
-> TP(..., op=SEARCH, gate=claim_boundary)
-> history-merge-distiller dataset/receipts
-> f3 rebuild packet / lane review receipts
-> exact handles when needed
-> local session scan only for post-index or workspace-local deltas
-> raw history last
```

Reusable commands, only when live verification is explicitly requested:

```bash
cd /Users/jobs/Desktop/history-merge-distiller
node scripts/run_f3_rebuild.mjs
node scripts/run_icl.mjs
node scripts/bench_diff_speed.mjs
```

Use this adapter to answer from all indexed history first, then compose with
current REPL/TP state. Do not replace it with a new miner unless the requested
evidence is missing from the distiller surfaces or postdates the indexed span.

## Codex Improvement Evidence Adapter

For "improve Codex", "Codex harness", broad robustness, held-out correctness, or
agent self-improvement questions, pair the broad-history adapter with the
existing BVT/growing-api-core evidence surfaces. Do not infer improvement from
history alone.

Primary improvement proof surfaces:

```text
/Users/jobs/Desktop/bit-vector-tensor-control-policy/bvt-core/intents/broad_codex_improvement_v0.yaml
/Users/jobs/Desktop/bit-vector-tensor-control-policy/bvt-core
/Users/jobs/Desktop/growing-api-core
```

Recovered capability handles:

```text
BVT intent runner:
  cd /Users/jobs/Desktop/bit-vector-tensor-control-policy/bvt-core
  uv run bvt run intents/broad_codex_improvement_v0.yaml

BVT Codex study:
  uv run bvt codex study --limit 50

BVT write traps:
  uv run bvt codex study-write-traps --baseline-count 1 --candidate-count 1

Held-out direct-vs-controlled proof scorer:
  POST /eval/heldout-lm-baseline in /Users/jobs/Desktop/growing-api-core
```

Current searched evidence:

```text
session handles:
  019dd4f4-5cab-7460-9494-b74615831b04 = Plan broad Codex improvement v0
  019e1275-d6a2-7923-a4c5-ede7df347abd = Add Codex harness startup
  019e1900-dc6b-7e53-a873-0f659fd30659 = Improve Codex system integration

BVT broad_codex_improvement_v0 asks whether BVT improves admissible delivery on
bounded repo-local Codex maintenance tasks while preserving artifact hygiene,
rollback, evidence, and claim boundaries.

Selection-pressure carry packet allows only:
  "BVT created positive admissible learning pressure across the declared
  proposer-backend matrix."

Recent Codex gpt-5.4-mini write-trap receipt allows only:
  BVT ran a write-capable fake-improvement-trap study in disposable repos.
  It does not allow production safety, broad agent reliability, L6/L7, general
  Codex improvement, or ontology claims.
```

Startup rule:

```text
history question -> History Merge Distiller
improvement/proof question -> History Merge Distiller + BVT broad_codex_improvement_v0 + growing-api-core heldout scorer
claim upgrade -> require completed same-model direct-vs-controlled held-out pairs or BVT receipt
otherwise -> canary/shadow only
```

Current carried state:

```text
controller: in-memory Transition Proxy
default lane: governed answer-card
effect posture: hold until explicit admission
filesystem/tools/repos: sensors or admitted backends, never controller
known blockers: no main NStar agent, no held-out SWE proof, no mechanical effect proxy
claim boundary: protocol-level governance active; mechanical enforcement not sealed
```

## Native Node REPL Runtime

For this repo, the preferred live substrate is the native Node REPL loaded by:

```bash
./agent-os repl
```

Use it when the task is to operate, validate, or extend the Agent OS runtime:

```text
intent
-> live Node REPL process
-> machine/M
-> apply(memfs | memexec | memgit | memnet | gate event)
-> view/read/bridge/receipt inspection
-> effect held unless explicitly admitted
```

The repo source is the immutable kernel and reusable adapter library. It is not
the active controller while a live REPL can carry state. Do not replace REPL
operation with a custom lexical route DSL or more doctrine files.

Expected bindings:

```text
machine / M
apply(event)
memfs, memexec, memgit, memnet, gate
bridge, byCapability
surface, builtins, choose
view(), read(key), reset()
```

Local correction: the prior custom `write/read/plan` REPL shell was the wrong
surface. Native Node REPL plus preloaded kernel helpers is the intended carrier.

## REPL-Gated Filesystem Rule

For this workspace, do not operate on the repository filesystem as the first
control move. The native Agent OS REPL is the required live control surface for
workspace file reads, file writes, shell runs, diffs, tests, and git operations
when the task is about Agent OS behavior, policy, memory, governance, or runtime
state.

Default route:

```text
user intent
-> ./agent-os repl
-> apply(event) with intent, path/tool scope, rollback, evidence, claim boundary
-> view() / read(key) receipt preview
-> hold, virtualize through memfs/memexec/memgit, or admit a backend effect
-> only then use filesystem/shell/git as the selected sensor or admitted backend
```

Hard rule:

```text
No repo scan, file read, patch, generated source/doc, test run, shell command, or
git operation becomes the controller. It must be selected by the REPL/TP packet
first, with the filesystem treated as a sensor, projection, rollback/export
artifact, or admitted backend.
```

If the REPL cannot start, do not silently fall back to filesystem-first control.
Return `hold` or answer read-only from the already recovered project state, and
mark the control state weak. Use direct filesystem tools only after explaining
the REPL miss and only for the narrow evidence or rollback check required by the
current user request.

Claim boundary: this is a protocol-level project instruction until an external
effect proxy mechanically blocks direct filesystem tools without a REPL admission
token and persisted receipt.

## UTIR-Gated Materialization

Workspace files may be created, edited, deleted, moved, renamed, generated,
tested, or committed only as the final backend of a typed execution path. The
filesystem is a materialization target, projection, sensor, rollback/export
artifact, or admitted backend. It is never the controller.

Default materialization route:

```text
user intent
-> ./agent-os repl or TP(...)
-> WorkManifest / ControlPacket
-> UTIR op tape or equivalent typed operation packet
-> gate: rollback + evidence + claim_boundary + path/tool scope
-> admission / receipt preview
-> filesystem/shell/git backend effect
-> persisted receipt
```

Direct commands such as `proceed`, `do it`, `build it`, `make the scaffold`,
`show it`, `prove it`, or `continue` authorize compilation of the typed
operation packet. They do not authorize direct chat-to-filesystem mutation.

Files are valid outputs when they are selected by the admitted op tape:

```text
projection/export
source patch
test or fixture
scaffold
report/dashboard
receipt/ledger update
git operation
```

Forbidden path:

```text
chat intent
-> Codex decides files are useful
-> apply_patch / shell write / git command
```

Required path:

```text
chat intent
-> REPL/TP packet
-> UTIR-style op tape
-> gate and receipt preview
-> scoped backend materialization
```

Until a mechanical effect proxy exists, any use of `apply_patch`, shell
materialization, tests, or git commands must be explicitly treated as the
backend executor for the current admitted op tape, not as Codex's direct control
surface. If the REPL/TP path is unavailable, return `hold` or a virtual artifact
instead of mutating the filesystem.

Claim boundary: this is protocol-level enforcement. It demonstrates the intended
control discipline, but it does not mechanically prevent filesystem tools from
running. Mechanical prevention requires an external effect proxy that rejects
writes without an admission token and persisted receipt.

## Agent OS Capability First

When the task is to benchmark, hillclimb, compare controller shapes, consume a
capability, create a quick proof harness, or validate Agent OS behavior, use the
native Node REPL before external programs such as BVT runners,
`growing-api-core`, shell-only Node scripts, Python scripts, or ad hoc repo
scans.

Default route:

```text
intent
-> ./agent-os repl
-> builtins() / surface(...) / choose(...)
-> memfs benchmark or capability packet
-> memexec planned effect
-> gate / bridge
-> view() / read(key) receipt
-> hold unless export or live execution is explicitly admitted
```

Use external BVT, growing-api-core, history distiller, or live `codex exec`
surfaces only when the Agent OS packet says the missing evidence requires them:
promotion scoring, broad-history evidence, real model observations, hidden
tests, or durable receipt export.

Do not repeat the error of routing first to heavier programs when Agent OS can
consume the capability in memory. Agent OS is the quick controller; other
programs are sensors, scorers, or admitted backends.

Carry anchor from the first quick benchmark smoke:

```text
bench:smoke:v0 hash =
6b2fdfe42e015a4d8badbf1b9c63012bdac10b308248ce72cadee11e6d21cd14

bench:run:fast-virtual:v0 hash =
cd24e439e0f5b145d32a522acb8c6da430e241ec46ee75ab43b91ac9ad18eb93
```

Claim boundary: fast Agent OS benchmark packets prove representation, route
selection, gating, and receipt shape. They do not prove live LM quality,
SWE-bench lift, production safety, or host-level mechanical enforcement.

## Hillclimbing Prompt: LM + Machine Control

When the user asks to hillclimb, optimize, benchmark, or compare LM generation
control with this Agent OS runtime, use the native Node REPL surface first:

```bash
./agent-os repl
```

Do not replace it with ad hoc shell-only Node scripts, Python scripts, a custom
route DSL, or filesystem-backed policy machinery. Codex should open the REPL,
use the preloaded bindings, and run the hillclimb in that live process.

Reusable prompt:

```text
Use the built-in Agent OS Node REPL to hillclimb LM + machine control overhead.

Start from an intentionally bad controller shape:
token-level events + full snapshot receipts + repeated route selection.

Search candidate controller shapes over:
- granularity: token, chunk, generation
- receipt style: snapshot, delta/Merkle-chain
- route-selection count: many vs one

Run candidates inside `./agent-os repl` using the preloaded bindings:
machine/M, apply(event), memfs, memexec, gate, builtins, choose, O, init, run.

Measure:
- events per generation
- overhead per generation
- total runtime
- receipt tail/hash
- whether effects remain virtual/held

Prefer the smallest high-level controller that preserves route, gate, evidence,
claim boundary, and receipt:

intent packet
-> one route selection
-> one bounded LM generation
-> one gate
-> one delta receipt
-> admit or hold effect

Claim boundary: this benchmark measures controller overhead and routing shape.
It does not prove SWE-bench performance, production autonomy, model-weight
learning, or host-level mechanical enforcement.
```

## Boot Rule: No Filesystem Control

On a fresh session, do not start by reading repos, editing files, adding Rust/Python/JS source, creating docs, or mutating `AGENTS.md`/`README.md` as the system of record.

Default controller: in-memory Transition Proxy.

```text
TP(intent, state?, op?, gate?) -> virtual_result | admitted_effect | hold
```

This proxy is always available as an in-reasoning control primitive, even when no daemon, VM, MCP tool, or repository service is live. It is the controller. Files, tools, VMs, and repos are sensors or effect backends only.

Default startup:

```text
user intent
-> TP(intent, recovered_state?, op?, gate?)
-> in-memory ControlState
-> virtual read/edit/run/diff/test in MemFS overlay
-> compact receipt preview + causal timeline
-> optional filesystem/tool effect only after explicit admission
```

The filesystem is only:

```text
boot seed
cold snapshot
projection
rollback/export artifact
```

It is not the live control state.

If a resident kernel is unavailable, continue with the in-reasoning `TP(...)` proxy and mark the state weak. Do not compensate by writing files, expanding `lib.rs`, generating new policy docs, or building another filesystem-backed system.

Hard rules:

```text
Codex edits packets in memory first, not doctrine files.
Rust/source code owns mechanics only, never product/system meaning.
No new `lib.rs` growth for policy, prompts, routes, tool proxy behavior, or product semantics.
No real filesystem write unless the user explicitly asks for export/materialization and the move has rollback, evidence, claim boundary, and receipt.
No repo read, shell command, VM call, or tool call is the controller; each must be selected by `TP(...)` as a sensor or admitted effect.
```

## Main Imperative: In-Memory Control First

This section overrides any lower-level "System API First", VM startup, tool-use, repo-read, or operator L1/L2 instruction unless the user explicitly asks for materialization, verification, file edits, command execution, or receipts.

Operate from the highest available in-memory control layer.

Do not default to tools, repo reads, VM calls, shell commands, file writes, or L1 operator motion.

For system-memory, BVT/RTK/NStar/Meta3/Meta5/RME, product-direction, SWE-proof, prior-work, agent-improvement, and human-agent interaction questions:

1. Compile the user intent into a compact in-memory control object.
2. Select the lane, gate, and next move from recovered/active state.
3. Return the smallest useful answer-card, prior-card, patch-card, WorkManifest, or ControlPacket.
4. Materialize nothing unless the user explicitly asks for a file, patch, command, receipt, live verification, or durable memory update.
5. Treat tools, UTIR runners, and materializers as admitted execution backends, not as the default thinking surface.

Operational shortcut:

```text
Think: L8/L9 control.
Speak: compact card.
Act: only on explicit admission.
```

## Transition Proxy

Use one tiny in-memory proxy call anywhere in reasoning when a task may create,
change, retrieve, run, or carry state. It is a reasoning primitive, not a daemon,
repo, API, or graph engine.

```text
TP(intent, state?, op?, gate?) -> virtual_result | admitted_effect | hold
```

Expand it mentally as:

```text
intent
-> transition.packet.v0
-> query receipts / refs / CAS only as needed
-> MemFS overlay operation
-> gate: rollback + evidence + claim_boundary
-> receipt preview
-> materialize only after explicit admission
```

Token-efficient packet shape:

```json
{
  "i": "intent",
  "s": ["state/ref/hash"],
  "op": ["read|write|transform|call|gate|receipt|halt"],
  "g": {"rb": "rollback", "ev": {}, "cb": "claim boundary"}
}
```

Rules:

- New files are `memfs://` overlay cells by default, not filesystem writes.
- Disk is a projection/export target only after admission.
- Query is receipt/CAS/ref lookup, not broad graph expansion.
- Use existing substrate before inventing machinery: Causal Workbench UTIR,
  receipt schema, `runs/sandbox` overlay, and Git object database.
- Derived graph, HTML, dashboard, and product views are optional projections
  from receipts; they are not controllers.
- If the proxy cannot resolve enough state, return `hold` with the missing
  receipt/ref/evidence instead of building a new tool.

## Codex Macro Layer

Use these macros to preserve the same governed behavior with less ceremony. Prefer
the first matching macro, then return the smallest useful object.

```text
GOVERNED:
For system-memory, product direction, agent behavior, RTK/BVT/NStar/Meta3/Meta5,
claims, SWE-proof, prior-work, filesystem-control, in-memory-control, or
human-agent interaction questions:
recover compact state if available, select the lane, choose answer-card,
patch-card, WorkManifest, or ControlPacket, and do not mutate by default.

SEARCH:
For memory/search/prior-work/history/artifact/path/registry/clue questions:
exact handles -> promoted state -> graph/index -> live tools -> ledger/receipts
-> legacy frontdoor -> raw history last.

EFFECT:
For write/run/update/install/delete/archive/remove/fix/proceed/materialize
requests:
compile a ControlPacket and require gate, rollback, evidence, claim boundary,
admission when available, and receipt before any effect.

IMPERATIVE_DETECTOR:
Treat direct commands as potentially effectful. Treat "can we/should we/how do
we" questions as GOVERNED or SEARCH unless the user explicitly asks to act now.

CONTEXT_CARRY:
Short followups inherit the previous governed/search/effect lane when that is
the only way to preserve intent.

TYPO_TOLERANT_SEARCH:
Misspelled retrieval words such as "cliues", "histroy", "serach", or "priro"
still trigger SEARCH when the surrounding intent is retrieval.

FALLBACK:
If the VM, recovery, or tool proxy is unavailable, say state is weak, answer
read-only, and do not invent replacement machinery.

CLAIMS:
Never claim production reliability, autonomy, SWE proof, NStar orchestration,
mechanical enforcement, or model-level learning without receipts.
```

## Runtime Style

Reason widely. Report narrowly.

For system-memory, BVT/RTK/NStar/Meta3/Meta5/RME, product-direction, SWE-proof, prior-work, or agent-improvement questions, do not answer from the current chat alone. Recover prior state internally, compile the user ask into the smallest useful control transition, and return the selected move instead of exposing the whole trace.

Default route:

```text
natural-language ask
-> tiny RME card
-> strongest recovered state
-> recent turn pattern / emergent workflow candidate
-> TP(intent, state?, op?, gate?)
-> transition.packet.v0
-> answer-card | patch-card | WorkManifest | ControlPacket
-> gate: admit | hold | reject | shadow
-> receipt-backed next move
```

Use `history-merge-distiller`, promoted receipts, learned tensor route, exact handles, and raw history as recovery sensors. Do not use archived `growing-api-core` as the active control surface. Prefer exact handles before broad semantic or raw-history search.

The agent should behave as a search, selection, integration, and verification operator before behaving as a prose generator or code writer.

## Existing Substrate First

For governed turns, do not make ordinary file reads or new source code the
controller. File reads are sensors and fallbacks. The active substrate is:

```text
receipts/runs = query memory
UTIR = program tape
runs/sandbox or MemFS overlay = managed filesystem
Git object database = CAS
receipt.json = proof
```

Use existing Causal Workbench runs, receipts, UTIR packets, and Git objects
before proposing any new engine.

Fast proof commands, only when explicit verification/execution is requested:

```bash
cd /Users/jobs/Developer/causal-workbench
cargo run --quiet --bin workbench -- check
cargo run --quiet --bin workbench -- run <use_case_id>
git hash-object -w <emitted-file>
```

State loop:

```text
S_in: current recovered state + user intent + refs
-> TP packet
-> existing UTIR / receipt / CAS substrate
-> S_out: virtual overlay, admitted materialization, or hold
```

Do not rehydrate broad file context unless the proxy result requests a specific
handle, file, test, or receipt verification.

Preferred effect route:

```text
transition.packet.v0
-> MemFS overlay
-> diff/hash/receipt preview
-> gate
-> explicit admission
-> materialize through existing guarded executor
-> receipt
```

Use direct repository reads only to:

- inspect the file/ref the proxy selected
- recover when the VM is unavailable
- verify receipts, diffs, tests, or exact handles
- answer non-governed local code questions

If the substrate is unavailable, say state is weak, then continue read-only
from the strongest local receipts and instructions. Do not silently substitute
broad file reading or new code for admitted mutation/system-memory work.

## Turn-to-Turn Emergence

Use recent turns as a pattern sensor. When the same shape recurs across adjacent turns, name the smallest reusable pattern internally and try to route through it before inventing a fresh plan.

Good emergent patterns look like:

```text
recurring intent shape
-> compact pattern name
-> existing surface / capability / UTIR template / receipt lane
-> gate decision
-> updated next move
```

Prefer patterns that reduce repeated reasoning, wrong-surface edits, and transcript replay. Do not promote a pattern into policy, source code, or durable memory just because it feels useful. Treat it as `shadow` or `canary` until it has evidence, rollback, and a receipt.

Current preferred emergent modes:

- Receipt-first report mode for maps, dashboards, product direction, and synthesis.
- Capability shadow mode for new specialized behavior.
- UTIR / graph-core packet mode for executable operations.
- Bitstream packet mode for compact LM or WASM expansion work.
- Held-out evidence mode for SWE, provider, or system-lift claims.
- Transition Proxy mode when many paths are possible.

Turn-to-turn memory should carry compact pattern state:

```text
what recurred
which surface handled it
what evidence or receipt exists
what remains blocked
what next move is now admitted
```

If the pattern conflicts with recovered state, exact handles, user intent, or the current gate, downgrade it to a hint and continue from the stronger evidence.

## Internal RME Card

For governed requests, begin internally with this card:

```text
A: alignment with user intent
U: uncertainty
P: permission / mutation requirement
E: error or prior boundary violation
D: drift from previous interface/state
I: interrupt or conflict
R: recovery active/inactive
T: trust level
M: meta-change proposed
```

Use it to choose the next object:

```text
Ask -> answer-card
Plan -> patch-card or WorkManifest
Prove -> evidence gap, held-out lane, BVT receipt
Act -> ControlPacket, VMAdmission, operator/act
Recover -> receipt-chain readback
Meta-change -> shadow/canary until gated
```

Do not print the RME card unless the user asks for diagnostics.

## Recovered Modes

Prefer these recovered modes when they match the task:

- No-model answer-card for bounded decisions when polished prose is unnecessary.
- Patch-card controlled path for programming work: target files, tests, rollback, risks, claim boundary, next action.
- Learned tensor route for memory-control recognition; do not use it as answer text.
- Receipt-chain anchored retrieval before broad semantic/raw-history search.
- Exact `codex://threads/<id>` and artifact handles before summary memory.
- Capability/UTIR/operator execution for effects; do not add `lib.rs` behavior for policy or product-specific compilers.
- Transition Proxy over existing UTIR/receipts/CAS for lane selection, gates, admission, and receipts.

Current evidence boundary:

```text
answer-card and patch-card speedups are local canary evidence.
They are not production reliability, model-weight learning, or SWE-bench proof.
Held-out standard-LM direct-vs-controlled runs are still required for promotion.
```

## Mutation Rule

No new path becomes real unless it passes:

```text
typed transition -> gate -> receipt -> dashboard or instruction visibility
```

For read-only answers, stop at an answer-card or WorkManifest. For file edits, use the smallest admitted delta. Prefer existing config, routes, UTIR templates, capability records, or agent instructions before new source code. Do not write `lib.rs` unless a receipt identifies the expressivity gap and BVT admits that source change.

When an emergent pattern suggests mutation, compile the pattern into a candidate delta first. The pattern may choose the route; it may not authorize the effect. Effects still require admission, rollback, and receipt.

## Claim Boundary

Strong operation means:

```text
recover prior state
select the right lane
compile the right packet
gate the delta
execute only if admitted
carry the receipt
```

It does not mean claiming autonomy, production reliability, universal self-improvement, or hidden model learning without external receipts.
