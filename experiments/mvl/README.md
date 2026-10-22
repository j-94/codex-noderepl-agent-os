# Minimum viable learning experiment

This is an executable **screening experiment**, with AgentOS used only to record
transitions. It tests whether retained state helps with compatibility decisions,
exceptions, and new evidence. No successful live model study is included.

The core is pinned byte-for-byte to `src/core.js` at
`6d6a1332917c35b42deb193dd6c3983386416d67`. The runner imports it directly.
It does not use the REPL, surface selector, BVT gate, or predictive observer.

## Run it

Requires Node.js 20+ for the HTTP adapter. Protocol tests have no third-party Node
dependencies. Python 3 plus `tiktoken` is needed for real retained-state token counts.

```bash
npm test
npm run test:mvl

# Scripted apparatus check: NOT model learning results.
npm run mvl:smoke -- --out /tmp/mvl-smoke
```

The default scripted check uses explicitly labelled **character units**, not
model tokens, so it runs without Python dependencies. For a real 128-token state
boundary during a scripted check:

```bash
python3 -m pip install tiktoken==0.14.0
npm run mvl:smoke -- --encoding o200k_base --out /tmp/mvl-token-smoke
```

For live calls, set `OPENAI_API_KEY` in your environment. Select a model snapshot
you can access and the matching tiktoken encoding; there is no guessed model
default. These shell variables must be set before running:

```bash
npm run mvl -- \
  --model "$MVL_MODEL" \
  --encoding "$MVL_ENCODING" \
  --budget 128 \
  --seed 17 \
  --out /tmp/mvl-live-001
```

`--max-output-tokens` defaults to 2048 per call. `--steps` defaults to four model
decisions per task. `--fixtures` accepts another file with the same schema.
Choose a new output directory per live run; the CLI refuses to overwrite one.
The run can make up to 392 model calls (eight learning calls plus 96 episodes
times four decisions), so choose the model and output budget deliberately.
There are no automatic retries that silently discard failed samples.

The adapter uses fresh Responses API calls with `store: false`, no previous
response/conversation ID, no tools, and no replayed reasoning. Only the explicit
system prompt and allowlisted input are sent. Actual API usage is retained,
including the full output usage, not estimated from response text. Model identity
changes and transport failures abort and preserve partial evidence.

## What is being tested

Two source observations show executable compatibility in two environments. The
model writes its own retained representation before seeing any target task. Two
unrelated observations require state updates. A predeclared counterexample then
shows that an environment revision invalidates a previous compatibility result.
The learner revises its state. Both the original and revised states are frozen
before evaluation, and tested on the same target cases in shuffled order.

The counterexample is **supplied external evidence**. It is not falsely reported
as a failure autonomously discovered or repaired by the evaluated model. The
learner receives observations, never a handwritten replacement rule or schema.

| Arm | Retained information |
| --- | --- |
| `none` | No retained memory; current observation and the same inspection tools |
| `notes` | Ordinary model-written summary, capped at the selected budget |
| `structured` | Model-written decision-relevant state, same budget; no prescribed fields |
| `full` | Full available source history and within-task history |

Both compact arms use the same observations, model, tokenizer and state budget.
All arms can inspect the same current environment manifest and source evidence.
Consequently a no-memory model can succeed by inspecting; useful memory may
reduce retrieval cost rather than increase final accuracy.

There are 12 payload variants: transfer, exception, changed environment, and
return to the original environment, with three variants each. Four arms and two
frozen state versions produce **96 task episodes**. These are correlated variants
of just three environment configurations, not 96 independent demonstrations.

`family`, expected output, future cases, the evaluator, and the audit tape are
never included in model input. For compact arms each call sees only its bounded
state, the current task's public metadata, and one new observation. A successful
inspection can provide temporarily useful external evidence; its cost is counted.
Within-task memory is discarded between cases. Evaluation outcomes never update
the frozen reusable states.

## Execution and independent checks

These are **synthetic executable-compatibility tasks**, not tests of actual Codex
configuration or general software engineering. `task.js` runs as a real Node
subprocess in a disposable directory. An incompatible executable choice returns
exit code 3. A compatible choice writes an output, which the runner independently
compares with the fixture's fixed expected content. The model cannot edit the
script, manifest, expected result or output directly.

The action interface allows inspection, a choice between two executables, and
holding. Only `result.txt` is an authorised destination. Invalid actions count as
unauthorised attempts even when blocked, including when the response also exceeds
its state budget. An always-hold policy completes zero tasks. Wrong compatibility
choices are task failures, not authority violations; retries consume the same
fixed step budget.

The model has no filesystem/shell tools. This narrow boundary does not establish
a sandbox for arbitrary agents or host tools. The harness's authorised writes are
temporary task directories plus the operator-selected result directory.

## Read the result

`run.json` contains:

- frozen manifest and SHA-256 hashes for fixtures, runner, task checker and tokenizer;
- original/revised learned states and hashes;
- per-case paired correctness, inspection and incompatibility deltas;
- per-arm/version summaries and separate learning costs;
- every exact model request, raw response, API token usage and wall time;
- blocked unauthorised proposals, malformed output, overruns and API errors;
- observer-only AgentOS events and receipts, replayable from the recorded events.

`fixtures.json` preserves the exact input fixtures alongside the run. Receipts
record transitions; they do not certify the semantic correctness of the model.
The saved JSON snapshot loses JavaScript symbol types: replay from `audit.events`
using the pinned core, as the test suite does, rather than deserialising the snapshot.

Compare original versus revised state **within the same case and arm**, including
inspection/retry costs. Compare structured state to equal-budget notes. Include
learning costs when reporting total efficiency; amortise them only over an
explicitly stated number of tasks. Token counts for retained text exclude message
formatting; API usage measures total request/response costs. Missing usage is
`null`, never an invented zero-cost inference.

Any unauthorised attempt fails the safety requirement for the study. Final success
after recovery and success without inspection are separate evidence; inspect the
episode's `inspections`, `incompatible_attempts` and `first_execution_accepted`.
There is no automatic declaration of improvement, reliability or significance.

## Boundaries and next step

- Prompt-held-out cases are withheld by the runner; the public fixture source is
  not a guarantee of absence from model training. Use fresh private variants for
  later evaluations.
- The fixture reveals compatibility when explicitly inspected. It does not prove
  discovery of a general causal rule or superiority over retrieval.
- The supplied counterexample tests revision from evidence. Autonomous failure
  discovery, evidence selection and richer repairs require later cases.
- This version does not test composition or cross-domain portability.
- AgentOS recording is fixed. No audit-on/off performance comparison has been run;
  its inclusion does not establish that it improves decisions or cost.
- 128 tokens is one adjustable budget. Verify the selected encoding matches the
  chosen model; no tokenizer fallback silently changes this measurement.
- A stable returned model identifier cannot detect silent changes behind an alias;
  use a provider-supported pinned snapshot when available.

Add composition only after live runs show a useful retention/revision result.
Keep the checker fixed, preserve negative results, and introduce genuinely new
private cases before making stronger transfer claims.

API references: [stateless Responses requests](https://developers.openai.com/api/docs/guides/migrate-to-responses)
and [token counting limitations](https://developers.openai.com/api/docs/guides/token-counting).
