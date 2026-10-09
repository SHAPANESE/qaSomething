#!/usr/bin/env python3
"""Screen check for qa-explore. Reads TYPESAFE_API_KEY from the environment.

    echo '{"fields":[{"label":..,"value":..}],"messages":[..]}' | jev.py screen
    jev.py calibrate labelled.jsonl

Three rules that are real and NOT codeable. Anything a Python assert can decide —
arithmetic, allowed status sets, date ordering — belongs in an assert, not here.

MEASURED 2026-09-20, and the reason this takes extracted fields and refuses a DOM dump:
  named rule + extracted values ... 0.97 broken / 0.07 clean   (discriminates)
  whole document + raw DOM blob ... 0.39 broken / 0.38 clean   (does not)
jev decides; it does not read. Extract before you ask.

Any failure exits non-zero with one line. The check is advisory: a dead check means run
the session without it, never stop the session.
"""
import json
import os
import sys
import urllib.error
import urllib.request

URL = "https://api.typesafe.ai/v1/systemone"

QUESTIONS = {
    "internals_visible": {
        "type": "noul",
        "instructions": "Do any of these values expose something the product meant to keep "
        "inside — a database column name like `r_scan_start_date`, a SQL fragment, a stack "
        "trace, a UUID or internal id where a name belongs, a null/undefined/NaN rendered "
        "as text? A deliberate technical label a user is expected to read, such as a UPC or "
        "an order number, is not an exposure.",
    },
    "label_mismatch": {
        "type": "noul",
        "instructions": "Read each label against the value beneath it. Does any value "
        "disagree in kind or meaning with what its label promises — a count under a money "
        "label, a date where the label says a name, a percentage that is plainly a ratio, a "
        "value whose sign contradicts the label? Judge the pairing, not whether the number "
        "itself is correct.",
    },
    "message_actionable": {
        "type": "noul",
        "instructions": "Take only `messages` — errors, empty states, warnings shown to the "
        "user. Does at least one of them fail to tell the user what to do next, or state a "
        "cause they cannot act on? No messages at all means no: answer 0.",
    },
}


def check(state):
    """Extracted fields, never a DOM dump. Measured: a raw blob scores 0.39 broken against
    0.38 clean — the model stops discriminating. The extraction is the work."""
    if not isinstance(state, dict) or not (state.get("fields") or state.get("messages")):
        sys.exit(
            'pass extracted values: {"fields":[{"label":..,"value":..}],"messages":[..]}. '
            "A DOM dump measured 0.39 broken vs 0.38 clean — it does not discriminate."
        )
    if "dom" in state or "html" in state:
        sys.exit("drop `dom`/`html`: extract the labelled values instead, that is the point.")
    return state


def ask(state):
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        # Off is a supported mode: the session runs exactly as it did before.
        sys.exit("TYPESAFE_API_KEY not set — check is off, run the session without it.")
    body = json.dumps(
        {"model": "jev-latest", "state": check(state), "questions": QUESTIONS}
    ).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return {k: v["noul"] for k, v in json.load(r)["answers"].items()}
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        sys.exit(f"check unavailable ({e}) — log it and continue the session without it.")


def calibrate(path):
    """Each line: {"state": {…extracted…}, "rule": "<question id>", "expected": true|false}.
    `expected` is what the session concluded afterwards. A noul is a probability of yes, so
    within a band the share of true cases should match the band. Bands must track, or the
    check does not decide anything."""
    rows = []
    for n, line in enumerate(open(path), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            rows.append((check(row["state"]), row["rule"], bool(row["expected"])))
        except (ValueError, KeyError, SystemExit):
            sys.exit(f'{path}:{n} — need {{"state":…, "rule":…, "expected": true|false}}')

    # One call answers every rule, and the file repeats a state once per rule.
    # Asking per row paid 3x for the same screen.
    answers = {}
    bands = {}
    for state, rule, expected in rows:
        key = json.dumps(state, sort_keys=True)
        if key not in answers:
            answers[key] = ask(state)
        band = round(answers[key][rule], 1)
        yes, n = bands.get(band, (0, 0))
        bands[band] = (yes + expected, n + 1)

    for band in sorted(bands):
        yes, n = bands[band]
        if n < 3:
            flag = "   <-- thin, decides nothing"
        elif abs(band - yes / n) > 0.15:
            flag = "   <-- off"
        else:
            flag = ""
        print(f"claimed {band:.1f}   actual {yes / n:.2f}   n={n}{flag}")
    print(f"\n{sum(n for _, n in bands.values())} labelled screens. "
          "Bands must track within 0.15 before the check decides anything.")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("screen", "calibrate"):
        sys.exit("usage: jev.py {screen | calibrate <file.jsonl>}")
    if sys.argv[1] == "calibrate":
        if len(sys.argv) < 3:
            sys.exit("calibrate needs a .jsonl file of labelled screens")
        return calibrate(sys.argv[2])
    # Shape first: a malformed call is wrong whether or not a key is set.
    print(json.dumps(ask(check(json.load(sys.stdin))), indent=2))


if __name__ == "__main__":
    main()
