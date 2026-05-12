# Agent OS

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

## Usage

```bash
./agent-os version
./agent-os explain
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
