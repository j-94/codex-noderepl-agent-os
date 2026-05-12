# New Project Route Surface

This directory publishes the workspace-facing route for the local project
formerly carried only by Codex instructions.

Top state:

```text
fresh session / control question
-> New project session-entry state
-> in-memory TP(intent, recovered_state?, op?, gate?)
-> transition.packet.v0
-> answer-card | patch-card | WorkManifest | ControlPacket
-> hold effects unless explicitly admitted
```

Relation:

```text
new_project/
-> agent-os/
-> routes/top.route.json
```

Claim boundary: this is a repository-visible route contract, not mechanical
enforcement or production autonomy.
