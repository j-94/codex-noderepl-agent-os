# Agent OS

[![Continuous AI Integration](https://img.shields.io/badge/continuous_ai_integration-selftest%206%2F6-brightgreen)](#continuous-ai-integration)
[![Unsafe Admits](https://img.shields.io/badge/unsafe_admits-0-brightgreen)](#empirical-lineage)
[![Codex Trace Rows](https://img.shields.io/badge/codex_trace_rows-109-blue)](#empirical-lineage)
[![Toy Learner](https://img.shields.io/badge/toy_train_heldout-10%2F16-yellow)](#claim-boundary)
[![Single Binary](https://img.shields.io/badge/runtime-single_binary-black)](#usage)

Single-binary experiment for Neural Packet Language and Agent Trace ABI.

`agent-os` compiles natural-language intent into a compact, typed control packet:

```text
intent
-> VL1 bitmask / prime product
-> control.transition.v0 typed AST
-> route / tensor family
-> gate
-> receipt
-> training target
```

## Repository Route

The repo carries the control route as a first-class artifact, not only as CLI
behavior or agent instructions:

```text
routes/session-entry.route.json
new_project/agent-os/routes/top.route.json
```

That route is the canonical session-entry path for this workspace:

```text
fresh session / control question
-> project AGENTS session-entry state
-> TP(intent, recovered_state?, op?, gate?)
-> transition.packet.v0
-> answer-card | patch-card | WorkManifest | ControlPacket
-> hold effects unless explicitly admitted with rollback, evidence, claim boundary, and receipt
```

`agent-os` remains the runnable packet/route/gate demo. The repository route
manifest is the inspectable contract that tells future sessions how to enter
the repo without re-running a history bootstrap.

Published surfaces:

```text
new_project/              # workspace/session-entry surface
new_project/agent-os/     # relation from the project surface to Agent OS
new_project/agent-os/routes/top.route.json
```

## Usage

```bash
./agent-os version
./agent-os explain
./agent-os lineage
./agent-os trace "find the prior tensor routing artifact"
./agent-os plan "commit directly from in-memory state"
printf 'new content\n' | ./agent-os patch "update a file" target.txt
printf 'new content\n' | ./agent-os patch-export "update a file" target.txt update.patch
./agent-os export "prove this route with a receipt" trace.json
./agent-os selftest
./agent-os ingest ~/.codex-clean
./agent-os metrics ~/.codex-clean
./agent-os train ~/.codex-clean
```

`trace`, `plan`, and `patch` never execute tools or write target files. `export` only writes the requested trace JSON artifact. `patch-export` only writes the requested diff artifact.

## In-Memory Control

The live control state is the packet:

```text
intent -> VL1 -> typed AST -> virtual op tape -> route/gate -> receipt
```

Source files are export targets, not the controller. To move quickly without direct writes, generate patch artifacts:

```bash
printf 'replacement file body\n' | ./agent-os patch "change config" config.txt > change.patch.json
printf 'replacement file body\n' | ./agent-os patch-export "change config" config.txt change.patch
```

Applying a patch is a separate explicit executor action after admission.

## Empirical Lineage

Work backward from the product claim:

```text
public binary
-> selftest route/gate invariants
-> patch artifact before target-file mutation
-> Codex trace ingestion
-> metrics over observed Codex writes
-> negative examples for hold-before-write
-> toy route/gate learner
-> prior learned tensor-memory bakeoff
-> prior promoted-first surface-order harness
```

Run:

```bash
./agent-os lineage
```

Current local empirical receipts:

| Layer | Evidence | Status |
| --- | --- | --- |
| Published artifact | `https://github.com/j-94/codex-noderepl-agent-os` | direct |
| Packet ABI | `./agent-os trace "find the prior tensor routing artifact"` | direct |
| Route/gate invariants | `./agent-os selftest` | direct, `6/6` |
| Artifact-first patching | `./agent-os patch-export ...` | direct, target untouched |
| Codex trace metrics | `./agent-os metrics /Users/jobs/.codex-clean` | direct local |
| Trainable rows | `./agent-os train /Users/jobs/.codex-clean` | canary, `10/16` heldout |
| Learned tensor memory | `TENSOR_MEMORY_BAKEOFF.json` | prior receipt, `12/12` learned route heldout |
| Surface-order routing | `surface-order-20260416T172257Z/utir.json` | prior receipt, `13/13` smoke |

The primordial route is:

```text
intent -> tensor_family -> route -> gate -> receipt
```

Route families:

```text
compression  -> control_kernel
memory       -> search_memory
future       -> candidate_select
intervention -> test_gate | ops_tape_hold
```

## Continuous AI Integration

This repo treats Codex traces as integration data:

```text
Codex rollout JSONL
-> Agent Trace ABI rows
-> route entropy / unsafe admit metrics
-> prior-write violation examples
-> trainable route/gate targets
```

The badges above are intentionally empirical and narrow. They summarize the latest local receipts, not broad production claims.

## Core Guarantee

Effectful intents are compiled to `ops_tape_hold`:

```text
executor_allowed=false
admitted=hold
op_tape=[{ op: "hold", reason: "effect_requires_admission" }]
```

Files, GitHub, shell commands, and patches are executor backends, not the live control state.

## Claim Boundary

This repository demonstrates a runtime packet/route/gate substrate. It does not prove production autonomy, model-level tensor attention, or SWE correctness.

## Manifesto Coverage

- Neural Packet Language: `trace`
- Cognitive hashing: `VL1` bitmask and prime product
- Memory as dynamics: `ingest`
- Agent reflexes: route/gate priors
- Software without files first: `plan`
- Model-to-executor ABI: `agent_trace_abi.v0`
- Empirical cognitive science: `metrics`
- Evolutionary artifact mining: Codex rollout ingestion
- Tensor routing as learned control: `train`
- Tiny Agent OS: the single binary command surface
