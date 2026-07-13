---
name: qa-report
description: Use to produce the QA sign-off summary — what's covered by trusted tests, what's NOT and why, the spec gaps, and the bugs found — over the whole casebook. Triggers on "sign-off", "QA report", "what's covered", "release readiness", "summarize the QA".
---

# qa-report — the sign-off summary

Reads the whole casebook and renders an honest release-readiness summary. The discard
(what you chose NOT to test, and why) is part of the report.

## Steps

1. Read `cases.md`, `gaps.md`, `runs/<latest>.json`, and `findings/` from
   `<repo>/.qa-agent/`.
2. **Render deterministically with the engine command** (preferred):
   `node <qa-agent>/dist/index.js report --repo <repo>` (build first with
   `pnpm build`). It computes coverage from case statuses (passing / total), renders
   the summary via the `renderReport` helper, writes `<repo>/.qa-agent/report.md`, and
   advances that ticket's phase in `state.json` to `reported`. Pass `--ticket <id>` if
   the casebook tracks more than one ticket. (If you can't run the command, write the
   equivalent markdown yourself — headline + coverage; **covered by trusted tests**;
   **bugs found** (+ finding files); **NOT covered (and why to look)**
   (planned/authored/failing/flaky cases); **spec gaps** from gaps.md — and set the
   phase manually.)
3. Present the summary to the user.

## Rules

- Be honest about what was NOT covered and why — that's the senior-QA value, not a gap
  to hide. Coverage is passing cases / total, not "tests written".
