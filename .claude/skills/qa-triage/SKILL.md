---
name: qa-triage
description: Use to diagnose test failures and flakiness — decide whether a failing test is locator-drift (send to repair), a real behavior-regression (file a bug), or flaky, and record it. Triggers on "why did this fail", "is this flaky", "triage the failures", "diagnose this test".
---

# qa-triage — diagnose failures & flakiness

For each failing/uncertain spec, classify WHY and record it. Does not write tests or
bugs itself — it routes.

## Steps

1. Read `<repo>/.qa-agent/runs/<latest>.json` (or run the failing spec now). For a
   flakiness check, re-run a spec N times.
2. Classify with the engine (deterministic): `node <qa-agent>/dist/index.js triage
--repo <repo> --spec <path> --reruns 3`, or reason from the Playwright output —
   element-not-found/timeout → **locator-drift**; an assertion Expected/Received
   mismatch → **behavior-regression**; mixed pass/fail across reruns → **flaky**.
3. Record each non-passing spec in `<repo>/.qa-agent/flaky.json`:
   `{ "version": 1, "entries": [ { "spec": "tests/x.spec.ts", "caseId": "TC-...", "class": "flaky|locator-drift|behavior-regression|unknown", "note": "<evidence>", "updated": "<ISO8601>" } ] }`
   (one entry per spec, latest wins).
4. Route: **locator-drift** → suggest `qa-author`/repair (re-anchor locators, never
   weaken asserts). **behavior-regression** → the app likely violates the ticket →
   suggest `qa-bug` and set that case's `status` to `failing`. **flaky** → set case
   `status` to `flaky`.
5. Set this ticket's phase in `state.json` to `triaged`.

## Comparing runs — count is not identity

**An identical failure count is not an identical failure set.** A gate that read
`111 passed / 35 failed` on two different dates looked like a stable known state; diffing by
test id showed 7 failures in and 7 out. Diff failure sets **by test id**, never by count, and
say so in the note when a spec flips between runs.

A suite whose specs seed into a shared environment interferes with itself. When the same spec
flips across runs, the honest verdict is **the suite is untrustworthy as a gate** — say that,
instead of triaging its individual failures as if each were a finding.

## Contract (API) failures

A Schemathesis contract violation (`api --json` → an operation with `outcome: fail`)
is a **behavior-regression** by construction: the API broke a rule its own contract
(the ticket's ACs) declares — there is no "locator" to drift. Route it to `qa-bug`,
set the case `status: failing`, and put the emitted `curl` repro + the check name in
the `note`. An `inconclusive` operation (schema didn't load, API down, Schemathesis
missing) is an ENV problem, not a regression — fix the setup and re-run.

## Rules

- Distinguish an ENV problem (app down, browser missing) from a real failure — don't
  file drift/regression for a broken environment.
- Evidence, not guesses: quote the real output in the `note`.
- **Name the most boring alternative before you classify, and kill it.** Before
  `behavior-regression`: the test was always wrong, the fixture never seeded, a precondition
  the spec assumes was not met, another spec in the same run wrote the row first. A
  regression is the *interesting* answer, so it needs the boring ones ruled out, not the
  other way round.
- **Grade the class itself `[V]` or `[I]`, in the `note`.** `[V]` = the reruns or the
  runner output prove this class. `[I]` = you reasoned it from a single run. The class is
  a claim, not an observation: `behavior-regression` sends a developer to a bug, and an
  `[I]` class spends their day. **`flaky` from one run is never `[V]`** — mixed outcomes
  across reruns are the only evidence that word has.
