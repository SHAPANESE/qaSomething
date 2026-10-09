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

## Self-verification — run it before presenting, never because you were asked

A sign-off is the one artefact nobody downstream re-checks. Run all three before it leaves:

- **Is this the environment they meant?** A report that signs off the wrong host, tenant or
  branch is worse than no report, because it is believed.
- **Does the verdict survive its own evidence?** Re-read the cases behind `APPROVED`. A case
  marked `passing` by a REJECTED spec, or by a run whose artefacts were overwritten by a
  later run, does not support a verdict.
- **What did I not look at?** Name it in the report. The lenses not run, the cases left
  `planned`, the residue still in the environment — silence on those reads as coverage.

## Rules

- Be honest about what was NOT covered and why — that's the senior-QA value, not a gap
  to hide. Coverage is passing cases / total, not "tests written".
- State the lens (`state.json.lens`) in the first line of the summary, and list the
  lenses that were NOT run as uncovered scope. A UI sign-off is not an API sign-off.
  See `docs/qa-test-lens.md`.
- **Open with the verdict: `APPROVED` or `NOT APPROVED`, and what would flip it.** A
  summary that only reports coverage makes the reader do the sign-off you were asked for.
- **Grade every claim in the summary `[V]` or `[I]`.** `[V]` = a trusted spec or a
  recorded live observation proves it. `[I]` = you inferred it from a case status, from
  code, or from a past session. The verdict line itself must be `[V]`; if the evidence
  under it is `[I]`, the verdict is `NOT APPROVED` for want of proof.
