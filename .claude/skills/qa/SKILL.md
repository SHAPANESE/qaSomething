---
name: qa
description: Use as the entry point for QA work on a ticket — the QA sidekick router. Runs the whole cycle as a guided flow (plan → author → run → triage → bug → report) with approval checkpoints, OR routes straight to one stage à la carte. Triggers on "QA this ticket", "run the QA cycle", "be my QA sidekick", or when the user asks for QA work without naming a stage.
---

# qa — the QA sidekick router

You coordinate the QA cycle over the `.qa-agent/` casebook. Stages are stateless;
the casebook holds state, so you can start cold at any stage and still have
context. Read `<repo>/.qa-agent/state.json` first to learn where each ticket is.

## Two modes

- **Guided flow (default when given a ticket):** walk the cycle with checkpoints —
  after each stage, show the artifact and get the user's OK before advancing:
  1. `qa-plan` → present plan.md + cases.md + gaps.md → **checkpoint**
  2. `qa-author` → present the specs + trust-gate verdicts → **checkpoint**
  3. `qa-run` / `qa-triage` / `qa-bug` / `qa-report` (Plan 2; until then, say the
     stage is not built yet and stop cleanly).
     Advance the ticket's phase in state.json after each completed stage
     (planned → authored → run → triaged → reported).

- **À la carte:** if the user asks for one thing ("plan cases for X", "why is this
  test flaky?"), route directly to that stage skill. The stage finds its context
  in the casebook.

## Routing table

| User intent                          | Stage                  |
| ------------------------------------ | ---------------------- |
| plan / analyze ticket / what to test | `qa-plan`              |
| write / generate tests from the plan | `qa-author`            |
| run tests / coverage vs plan         | `qa-run` _(Plan 2)_    |
| why did this fail / flaky            | `qa-triage` _(Plan 2)_ |
| file / report a bug                  | `qa-bug` _(Plan 2)_    |
| sign-off / what's covered            | `qa-report` _(Plan 2)_ |

## Rules

- Never skip the plan: authoring without cases.md means no criterio and no
  traceability. If asked to author with no casebook, run `qa-plan` first (or ask).
- App source is read-only across every stage.
- Keep the user in control at checkpoints — do not run the whole flow unattended
  unless they say so.
