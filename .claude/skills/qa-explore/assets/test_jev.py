#!/usr/bin/env python3
"""One check for the two things in jev.py that can silently go wrong.

    python3 test_jev.py

No framework on purpose. It stubs `ask` so it never touches the network or a key.
"""
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jev

A = {"fields": [{"label": "Total", "value": "$4.49"}], "messages": []}
B = {"fields": [{"label": "Total", "value": "$9.99"}], "messages": ["Nothing here."]}
RULES = ("internals_visible", "label_mismatch", "message_actionable")


def write(rows):
    f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    for state, rule, expected in rows:
        f.write(json.dumps({"state": state, "rule": rule, "expected": expected}) + "\n")
    f.close()
    return f.name


def run(rows, scores):
    calls = []

    def fake_ask(state):
        calls.append(json.dumps(state, sort_keys=True))
        return scores

    real, jev.ask = jev.ask, fake_ask
    try:
        out = io.StringIO()
        with redirect_stdout(out):
            jev.calibrate(write(rows))
        return calls, out.getvalue()
    finally:
        jev.ask = real


# A state repeated once per rule must cost one call, not three.
rows = [(s, r, False) for s in (A, B) for r in RULES]
calls, _ = run(rows, dict.fromkeys(RULES, 0.1))
assert len(calls) == 2, f"expected 1 call per distinct state, got {len(calls)} for 6 rows"
assert len(set(calls)) == 2, "the two distinct states were not both asked"

# A band holding fewer than 3 rows must not be read as agreement or as a failure.
calls, out = run([(A, "label_mismatch", True)], dict.fromkeys(RULES, 0.9))
assert "thin" in out, f"a band with n=1 was reported as if it decided something:\n{out}"
assert "<-- off" not in out, f"a band with n=1 was flagged off:\n{out}"

# A band that genuinely disagrees still says so.
rows = [(A, "label_mismatch", False)] * 3
calls, out = run(rows, dict.fromkeys(RULES, 0.9))
assert "<-- off" in out, f"claimed 0.9 against 0.00 actual was not flagged:\n{out}"

print("ok")
