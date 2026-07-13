---
name: qa-run
description: Use to run the authored Playwright tests, map each result back to its case, record the run, and update coverage vs the plan. Triggers on "run the tests", "run the suite", "what's the coverage", "did the tests pass".
---

# qa-run — run the tests, update the casebook

Runs the specs in the repo under test and records the outcome per case in the
casebook. It does NOT diagnose failures (that's qa-triage) or write tests (qa-author).

## Steps

1. Read `<repo>/.qa-agent/cases.md`. Determine the specs to run (the `spec:` of each
   authored case; or all `tests/*.spec.ts` excluding `*.mutation.spec.ts`).
2. Run them. Prefer the engine's trust gate for authored cases:
   `node <qa-agent>/dist/index.js verify --repo <repo> --all --json` — it already
   pairs each spec with its mutation and returns TRUSTED/REJECTED per spec. Otherwise
   run Playwright directly (`npx playwright test`).
3. For each spec, read its first line to get the `// case: TC-...` tag → map the
   result to that case id.
4. Write a run record to `<repo>/.qa-agent/runs/<ISO-date>.json` in this shape:
   `{ "date": "<ISO8601>", "results": [ { "spec": "tests/x.spec.ts", "caseId": "TC-...", "outcome": "pass|fail|inconclusive" } ] }`
   (an ENV/setup failure — app won't start, browser missing — is `inconclusive`, NOT
   `fail`; don't blame the test for a broken environment).
5. Update each run case's `status` in `cases.md`: TRUSTED/pass → `passing`; a real
   failure → `failing`. Leave `inconclusive` as-is and say so.
6. Set this ticket's phase in `state.json` to `run`.
7. Report coverage: passing/total, and which cases are failing/uncovered.

## Rules

- App source READ-ONLY. Only write under `.qa-agent/` (and never edit a test to make
  it pass — that's qa-triage/qa-author's call).
- A REJECTED (hollow/flaky) spec is a failing/flaky case, not a pass.
