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

Current carried state:

```text
controller: in-memory Transition Proxy
default lane: governed answer-card
effect posture: hold until explicit admission
filesystem/tools/repos: sensors or admitted backends, never controller
known blockers: no main NStar agent, no held-out SWE proof, no mechanical effect proxy
"~/Documents/New project/AGENTS.md" 392L, 14201B
