# QA Sidekick — design

> Status: approved for spec review · 2026-07-13
>
> Supersedes the single-purpose framing of the `qa-agent` skill. The engine and
> trust gates from [`2026-07-06-qa-agent-design.md`](2026-07-06-qa-agent-design.md)
> are unchanged and reused as-is; this document adds the sidekick layer on top.

## 1. Vision

A **QA sidekick that lives inside Claude Code** and works with you across the
_entire_ QA cycle — planning, authoring, execution, triage, bug reporting, and
sign-off — either as one **guided journey per ticket** or **à la carte** (jump to any
single stage). It reuses the existing TypeScript engine (`verify`, `triage`,
`mutate`, `oracle`, `loop`, `explore`) as deterministic "hands"; the new layer is the
conversational brain plus a persistent, auditable QA workspace.

The differentiator is **criterio**: the sidekick does not "run tests in general". It
applies senior-QA judgment to hunt edge cases, negatives, and gaps — and it makes that
judgment **auditable**, not a matter of trust.

### Non-goals (YAGNI)

- No web UI, no standalone TUI, no Slack/Jira bot as the interaction surface — the
  surface is Claude Code. (Jira/Confluence remain _data sources/sinks_ via MCP.)
- No new test runner or assertion library — Playwright + the existing gates stay.
- No multi-repo orchestration. One repo under test per workspace.
- No CI product; we only keep emitting JSON so an existing CI can gate on it.

## 2. Architecture

A **suite of focused stage-skills + a thin router**, all coordinating through a
**shared QA workspace** in the repo under test.

```
You (Claude Code)
   │  "QA this ticket"  /  "why is this test flaky?"  /  "draft cases for X"
   ▼
 qa  (router skill) ── guided flow: chains stages with approval checkpoints
   │                └─ à la carte: routes straight to one stage
   ├── qa-plan     enumerate risk-ranked cases (incl. negatives/boundaries) + gaps
   ├── qa-author   cases → trustworthy Playwright specs (+ mutation proof)
   ├── qa-run      run specs, map results to case-ids, coverage vs plan
   ├── qa-triage   diagnose failures & flakiness
   ├── qa-bug      draft/file bugs (markdown or Jira via MCP), linked to case-id
   └── qa-report   sign-off summary: covered / not-covered-why / gaps / bugs
        │
        ▼
  Shared QA workspace (.qa-agent/ in the repo under test, committed to git)
        │
        ▼
  Engine CLI (dist/index.js): verify · triage · mutate · oracle · explore
```

**Core property — stages are stateless; the workspace holds the state.** This is what
lets the guided flow and à la carte use share one code path: `qa-triage` reads the same
run-log that `qa-run` wrote; `qa-author` reads the plan that `qa-plan` wrote. Any stage
can be entered cold and still find its context on disk.

## 3. The backbone — workspace + traceability

Everything hangs off a **stable test-case ID** that threads the whole cycle:

```
Requirement (ticket AC) → Case TC-<TICKET>-NN → spec file → run result → bug finding
        └──────────────── the same ID links them all ────────────────┘
```

This is a **requirements traceability matrix**: from any requirement you can see which
case covers it, whether it passed, and whether it produced a bug. It is what makes the
sidekick a QA _tool_ rather than a test generator.

### Workspace layout (`.qa-agent/` in the repo under test)

```
.qa-agent/
  plan.md          # risk-ranked plan: what to test, what NOT, and why (human-editable)
  cases.md         # cases with frontmatter: id, ac, priority, scenario-coverage, status
  gaps.md          # spec ambiguities / undefined edge cases / contradictions (findings)
  runs/<date>.json # per-case result of each run (pass/fail/flaky, trust verdict)
  flaky.json       # flaky-test registry (fed by triage)
  findings/*.md    # bugs, each linked to its case-id + AC, with repro + evidence
  state.json       # per-ticket position in the cycle (for the router)
```

**Format rule:** human-readable markdown where a person intervenes (`plan.md`,
`cases.md`, `gaps.md`, `findings/`); frontmatter/JSON where stages hand off data
(`cases.md` frontmatter, `runs/`, `flaky.json`, `state.json`) so parsing is reliable.
Every generated spec carries its `case-id` in a comment/tag so run and triage can
re-link it.

### `cases.md` case entry (the traceability + criterio unit)

Each case records not just what it tests, but **which scenario categories were
considered** — so the judgment is auditable:

```markdown
---
id: TC-PROJ12-03
ac: "AC-2: reject login with an unregistered email"
priority: high # from Phase-1 risk ranking
category: negative # happy | negative | boundary | state | concurrency | security | a11y | ...
status: planned # planned | authored | passing | failing | flaky | bug
spec: tests/login-unregistered.spec.ts
---

Given an email not in the system, login shows "account not found" and does not submit.
```

Per prioritized item, `cases.md` must show the **scenario-coverage verdict** across the
brain's categories — _covered_ (a case exists), _discarded (why)_, or _gap (flagged in
`gaps.md`)_. A prioritized item with only a happy-path case is visible as such and must
be justified.

## 4. Criterio as the engine (not a doc consulted at the end)

The senior-QA brain (`docs/qa-senior-criteria.md`) is strong and already covers
negatives, boundaries, state, concurrency, formal techniques (equivalence
partitioning, BVA, decision tables, state transition, error guessing), and questioning
the spec. Today it is only wired into authoring. This design makes it the **motor of
`qa-plan`** and makes its output auditable:

1. **`qa-plan` is a discovery pass, not a listing.** For each risk-prioritized item it
   walks the brain's scenario categories and decides per category: covered /
   discarded-why / gap. Happy path is the floor, not the goal.
2. **Auditable scenario coverage** lives in `cases.md` (see §3) — you or CI can see at a
   glance whether negatives and boundaries for, say, login were considered.
3. **`gaps.md` is a first-class output.** Spec ambiguity, undefined edge case,
   contradiction, or unstated assumption → a finding _before_ any test is written.
   Finding bugs in the requirements is where the sidekick adds the most.
4. **Exploratory pass** uses the existing `explore` module as a gap-hunting dimension:
   walk the app with lenses (tours, "follow the data", CRUD per entity) to surface what
   the ticket does not say.
5. **`qa-report` is honest about what was NOT covered** and why (the discard is part of
   the criterio), and lists the gaps and bugs found.

## 5. The stages

| Skill           | Responsibility                                                                 | New / reuse                            | Reads → Writes                            |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------- |
| **`qa-plan`**   | Risk-prioritize, then discovery pass across scenario categories → cases + gaps | **new**                                | oracle → `plan.md`, `cases.md`, `gaps.md` |
| **`qa-author`** | Cases → trustworthy Playwright specs (+ mutation proof)                        | reuse (adapt current `qa-agent` skill) | `cases.md` → `tests/`                     |
| **`qa-run`**    | Run specs, map results to case-ids, compute coverage vs plan                   | new (thin)                             | `tests/` → `runs/<date>.json`             |
| **`qa-triage`** | Diagnose failures & flakiness                                                  | wraps `triage`                         | `runs/` → `flaky.json`                    |
| **`qa-bug`**    | Draft/file bugs (markdown or Jira via MCP), linked to case-id                  | new (thin)                             | failures → `findings/`                    |
| **`qa-report`** | Sign-off summary: ACs covered by trusted tests, not-covered-why, gaps, bugs    | **new**                                | whole workspace → summary                 |

Each stage is a focused skill file, invokable alone (à la carte) or chained by the
router. `qa-author` inherits the existing non-negotiables: app source is read-only;
every `X.spec.ts` needs an `X.mutation.spec.ts` that must go red; semantic locators
only; the ticket (not the running app) is the oracle.

## 6. The router (`qa`) — a state machine

`state.json` records where each ticket is in the cycle:

```
planned → authored → run → triaged → reported
```

- **Guided flow:** given a ticket, the router runs plan → author → run → triage → bug →
  report, pausing at **checkpoints** for your approval (e.g. you approve `plan.md` and
  `gaps.md` before any test is written).
- **À la carte:** "why does this test fail?" routes straight to `qa-triage`, which finds
  its context in the workspace.
- **Resumable:** because state lives on disk and in git, you can close Claude Code and
  resume the cycle later where it left off.

## 7. Extensibility (why this skeleton lasts)

- **Pluggable oracles:** file / Jira MCP / Confluence MCP — `qa-plan` accepts any.
- **Pluggable bug sinks:** markdown findings or Jira.
- **New stages plug in** without touching the others: add a skill + its workspace
  artifact (e.g. a future `qa-perf` or `qa-a11y`).
- **CI:** `verify`/`run`/`report` emit JSON, so the same workspace can gate CI.

## 8. Testing strategy

- **Engine unchanged** — its existing vitest suite stays green; no regressions.
- **Workspace I/O** (read/write/parse of `cases.md` frontmatter, `state.json`,
  `runs/*.json`) gets unit tests — this is the new load-bearing code, so it is tested in
  isolation with fixtures.
- **Skills are prompt artifacts**, validated by dogfooding against the existing
  `fixtures/` app: run the guided flow end-to-end and assert the workspace reaches
  `reported` with a coherent traceability chain (requirement → case → run → bug).
- **Eval extension:** add a labeled fixture where the app violates an AC and confirm the
  flow produces a `gaps.md`/`findings/` entry rather than a passing test.

## 9. Build order

Built as one coherent product; implemented in this order so each step is verifiable:

1. **Workspace module** — schema, read/write/parse, traceability IDs, `state.json`
   (unit-tested first; everything else depends on it).
2. **`qa-plan` + criterio wiring** — the largest net-new value; produces `plan.md`,
   `cases.md`, `gaps.md` with auditable scenario coverage.
3. **`qa` router + state machine** — guided flow with checkpoints; à la carte routing.
4. **Adapt `qa-author`** to read `cases.md` and write case-ids into specs.
5. **`qa-run`, `qa-triage`, `qa-bug`** — wire the existing engine stages behind skills
   that read/write the workspace.
6. **`qa-report`** — sign-off summary over the whole workspace.
7. **Dogfood** the full flow on `fixtures/`; extend the eval set.

## 10. Open questions (resolve during planning)

- Exact `cases.md` frontmatter schema (field names, allowed enums) — pin before coding
  the workspace module, since every stage depends on it.
- Whether `qa-report` output is markdown-only or also JSON for CI on day one.
- How `explore` output feeds `qa-plan` concretely (inline call vs. a pre-pass artifact).
