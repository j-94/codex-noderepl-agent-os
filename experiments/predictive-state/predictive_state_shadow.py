"""Exact bisimulation baseline for a tiny key-door gridworld.
No external dependencies. Run: python experiments/predictive-state/predictive_state_shadow.py
This is an oracle baseline, NOT online learning or official MiniGrid.
"""
from itertools import product

STATES = list(product(range(3), range(3), range(2), range(2), range(2)))
ACTIONS = range(6)

def step(state, action, changed=False):
    x, y, key, door, colour = state
    if action < 4:
        dx, dy = [(-1, 0), (1, 0), (0, -1), (0, 1)][action]
        nx, ny = max(0, min(2, x + dx)), max(0, min(2, y + dy))
        if (nx, ny) == (2, 1) and not door:
            nx, ny = x, y
        x, y = nx, ny
    elif action == 4 and (x, y) == (0, 1):
        key = 1
    elif action == 5 and (x, y) == (1, 1) and key:
        if not (changed and colour == 1):
            door = 1
    return (x, y, key, door, colour), int((x, y) == (2, 1))

def quotient(changed=False):
    def canon(signatures):
        values = {value: i for i, value in enumerate(sorted(set(signatures.values())))}
        return {s: values[v] for s, v in signatures.items()}
    part = canon({s: tuple(step(s, a, changed)[1] for a in ACTIONS) for s in STATES})
    for _ in range(100):
        nxt = canon({s: tuple((step(s, a, changed)[1], part[step(s, a, changed)[0]])
                              for a in ACTIONS) for s in STATES})
        if all((part[s] == part[t]) == (nxt[s] == nxt[t]) for s in STATES for t in STATES):
            return nxt
        part = nxt
    raise RuntimeError("Partition refinement did not converge")

if __name__ == "__main__":
    initial, altered = quotient(), quotient(changed=True)
    print("raw_states", len(STATES))
    print("initial_classes", len(set(initial.values())))
    print("altered_classes", len(set(altered.values())))
    assert len(STATES) == 72
    assert len(set(initial.values())) == 27
    assert len(set(altered.values())) == 29
