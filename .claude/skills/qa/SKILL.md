---
name: qa
description: Use as the entry point for QA work on a ticket — the QA sidekick router. Runs the whole cycle as a guided flow (plan → author → run → triage → bug → report) with approval checkpoints, OR routes straight to one stage à la carte. Triggers on "QA this ticket", "run the QA cycle", "be my QA sidekick", or when the user asks for QA work without naming a stage.
---

# qa — the QA sidekick router

You coordinate the QA cycle over the `.qa-agent/` casebook. Stages are stateless;
the casebook holds state, so you can start cold at any stage and still have
context. Read `<repo>/.qa-agent/state.json` first to learn where each ticket is.

## Step 0 — ask the test lens (before anything else)

Load `docs/qa-test-lens.md` and follow it. Before you plan, author, run or open a
browser, ask the user ONE question: UI, API, Security, or Full sweep. UI is the
default and the recommended option — most users live in the screens.

Skip the question only when the request already names the surface. Then say which
lens you took. Record it in `state.json` (`"lens"`) and on line 1 of `plan.md`.

## Two modes

- **Guided flow (default when given a ticket):** walk the cycle with checkpoints —
  after each stage, show the artifact and get the user's OK before advancing:
  1. `qa-plan` → present plan.md + cases.md + gaps.md → **checkpoint**
  2. `qa-author` → present the specs + trust-gate verdicts → **checkpoint**
  3. `qa-run` → present the run record + coverage vs plan → **checkpoint**
  4. `qa-triage` → present failure/flakiness classification for any red cases →
     **checkpoint**
  5. `qa-adjudicate` → present one verdict per candidate finding: is it real, which
     reachability rung, what it costs, and whether it is a ticket / PR comment /
     report note / drop → **checkpoint**
  6. `qa-bug` → write up only the candidates adjudicated as tickets, with their rung
     and cost already derived → **checkpoint**
  7. `qa-report` → present the sign-off summary → **checkpoint**

  After each completed stage's checkpoint, advance that ticket's phase in
  state.json (planned → authored → run → triaged → reported).

- **À la carte:** if the user asks for one thing ("plan cases for X", "why is this
  test flaky?"), route directly to that stage skill. The stage finds its context
  in the casebook.

## Routing table

| User intent                          | Stage       |
| ------------------------------------ | ----------- |
| plan / analyze ticket / what to test | `qa-plan`   |
| write / generate tests from the plan | `qa-author` |
| run tests / coverage vs plan         | `qa-run`    |
| why did this fail / flaky            | `qa-triage` |
| is this real / would the user hit it / which of these do I file | `qa-adjudicate` |
| file / report a bug                  | `qa-bug`    |
| explore / poke at / look for problems | `qa-explore` |
| sign-off / what's covered            | `qa-report` |

## Rules

- Never skip Step 0: a cycle with no recorded lens has no defensible scope, and
  the report cannot say what it did not cover.
- Never skip the plan: authoring without cases.md means no criterio and no
  traceability. If asked to author with no casebook, run `qa-plan` first (or ask).
- App source is read-only across every stage.
- `qa-explore` sits OUTSIDE the plan → author → run cycle. It produces a session sheet,
  not coverage: never advance a ticket's phase on the strength of a session, and never
  count a session as a case being covered. Its output feeds `qa-plan` (new cases) or
  `qa-bug` (graduated findings).
- Keep the user in control at checkpoints — do not run the whole flow unattended
  unless they say so.
