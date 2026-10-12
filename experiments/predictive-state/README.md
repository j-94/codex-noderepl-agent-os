# Predictive-state shadow experiment

This is an isolated, opt-in experiment. It does not change the existing agent runtime.

## Hypothesis
An action-conditioned predictive-state abstraction can merge observations with equivalent consequences and split them when new evidence reveals a relevant distinction.

## First benchmark
Use the deterministic key/door gridworld in `predictive_state_shadow.py`. Compare full state count with exact bisimulation classes before and after an environmental rule change. This is a mathematical sanity check, **not** learned state inference or evidence of LLM-agent gains.

## Next experiment
1. Capture timestamped action, observation, outcome tuples through a supported wrapper.
2. Learn outcome distributions on training episodes only.
3. Compare against full-history retrieval, fixed abstraction, and no-memory baselines on held-out episodes.
4. Record accuracy, calibration, adaptation delay, runtime, and state count.
5. Keep shadow mode non-intervening until results justify a controlled trial.

No autonomous promotion, production writes, or silent policy changes.
