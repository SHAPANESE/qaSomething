# qa-agent

A QA sidekick you work with inside Claude Code. Give it a web app and a ticket, and it
works the whole QA cycle with you like a senior tester.

## What it does

1. **Plans what to test — with real judgment.** It prioritizes by risk (deciding what
   _not_ to test) and goes beyond the happy path: negatives, boundaries, security, and
   more. If the ticket is ambiguous, it flags a **gap** instead of guessing. You get a
   plan you can review before any test code exists.
2. **Writes tests you can trust.** For every real test it also writes a "mutation" test
   that breaks the app on purpose. If the real test still passes when the behavior is
   broken, it asserts nothing — so it's rejected. A green test really means it catches
   bugs.
3. **Reports bugs, not false green.** The source of truth is the ticket, not the
   running app (copying the app would freeze its current bugs as "correct"). When the
   app breaks the ticket, it files a bug instead of writing a test that hides it.

**The key idea:** everything lives in a **casebook** (`.qa-agent/` in your repo) —
plan, cases, gaps, and bugs, linked by a stable id. At a glance you see: _this
requirement → this case → this test → passed or bug_. That's what makes it a real QA
tool, not just a test generator.

> In one line: an AI senior tester that **plans, writes, and stands behind**
> trustworthy tests — and finds bugs and gaps — working with you at every stage of the
> QA cycle.

See the design in [`docs/superpowers/specs/2026-07-06-qa-agent-design.md`](docs/superpowers/specs/2026-07-06-qa-agent-design.md).

## The QA sidekick (stages + casebook)

Beyond one-shot authoring, `qa-agent` works across the QA cycle from inside Claude
Code via a suite of stage-skills coordinated by a `qa` router, all sharing a
**casebook** — `.qa-agent/` in the repo under test:

| File         | Holds                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| `plan.md`    | risk-ranked plan: what to test, what was discarded, why                                   |
| `cases.md`   | test cases with a stable id, AC, priority, and **scenario category** (auditable criterio) |
| `gaps.md`    | spec ambiguities / undefined edge cases (findings before any test)                        |
| `state.json` | each ticket's position in the cycle (planned → … → reported)                              |

A stable case id (`TC-<TICKET>-NN`) threads requirement → case → spec → run → bug —
a traceability matrix. Stages are stateless; the casebook holds state, so you can
run the guided flow or jump to any stage à la carte.

Stages: **qa-plan** (design + criterio audit) · **qa-author** (write trustworthy
specs) · qa-run · qa-triage · qa-bug · qa-report _(the last four are Plan 2)_.

## Status

**Engine + trust gates + sidekick foundation: built and tested** (`pnpm test` → 127
green, `pnpm typecheck` → clean). In place: the loop, shell guardrails, git-backed
write-allowlist, model boundary, prompt, CLI, the **oracle** (ticket-derived source of
truth), the harness-enforced **trust gates** (quarantine + mutation polarity), and the
**casebook + stage-skill suite** (see above).

**Oracle = tickets.** Expected behavior derives from a `--ticket`, not from
observing the app (which would freeze current bugs as "correct").

**Mutation check.** For each `X.spec.ts` the agent writes a sibling
`X.mutation.spec.ts` that breaks behavior via `page.route` (no app-source edit).
The harness runs both and requires real→PASS, mutation→FAIL; a hollow test is
rejected.

**Also built:**

- **Casebook** (`src/casebook/`) — the shared `.qa-agent/` QA state: stable case ids,
  `cases.md` parse/serialize with scenario categories, the cycle-state machine, and
  the I/O layer (all zod-validated, unit-tested).
- **Stage skills** — `qa` (router), `qa-plan` (criterio-driven planning), `qa-author`
  (author trustworthy specs from the casebook). Run inside Claude Code, no API cost.
  The legacy all-in-one `qa-agent` skill is kept but deprecated.
- **`check-casebook`** (`scripts/check-casebook.mts`) — validates a produced casebook
  actually exercises criterio (fails a happy-path-only plan).
- **Eval harness** (`src/eval.ts`, `evals/*.eval.json`) — scores whether the trust
  gates classify a labeled test set correctly. Fixture eval: 3/3.
- **`verify` subcommand** — `qa-agent verify --repo <path> --all` runs the gates on
  existing tests, no agent.
- **Jira oracle** — `run --jira <KEY>` (needs `JIRA_BASE_URL`/`JIRA_EMAIL`/
  `JIRA_API_TOKEN`); the skill uses the Atlassian MCP instead.
- **Auto-repair** — `run --repair`: re-anchors drifted locators without weakening
  assertions (demonstrated on the fixture).

**Not yet built (Plan 2):** the back-of-cycle stages — `qa-run`, `qa-triage`,
`qa-bug`, `qa-report` — and their casebook artifacts (`runs/`, `flaky.json`,
`findings/` automation); element caching (Stagehand-style, cost). A live CLI agent run
still needs `ANTHROPIC_API_KEY`; the Claude Code skills need neither.

## Install

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-...
```

## Run

```bash
pnpm build
node dist/index.js "Test the login flow" --repo /path/to/your/app --ticket ./PROJ-12.md
# or, without building:
pnpm dev "Test the login flow" --repo /path/to/your/app --ticket ./PROJ-12.md
```

The `--ticket` file (markdown, text, or JSON) defines the expected behavior — the
oracle. Without it the agent has no source of truth and is warned.

Options: `--model <id>`, `--max-steps <n>`, `--timeout <ms>`, `--criteria <path>`,
`--skip-verify` (skip the trust gates).

### Run as a sidekick (inside Claude Code, no API key)

The stage skills let you drive the whole cycle conversationally — no
`ANTHROPIC_API_KEY` needed:

- **`qa`** — the router. "QA this ticket" runs the guided flow (plan → author → …)
  with checkpoints, or routes straight to a single stage.
- **`qa-plan`** — "plan QA for &lt;ticket&gt;" → a risk-ranked, criterio-audited
  casebook (`.qa-agent/plan.md`, `cases.md`, `gaps.md`).
- **`qa-author`** — "author the tests" → trustworthy specs (+ mutation proofs) from
  the casebook.

Validate a produced casebook exercises real criterio:

```bash
pnpm tsx scripts/check-casebook.mts /path/to/your/app
```

## Safety model

- **App source is read-only.** The agent may only write to `tests/`, `reports/`,
  and `.qa-agent/`. Any change outside those is reverted after each command via a
  git-backed guard (`src/workspace.ts`). Requires the repo under test to be a git
  repo; otherwise the agent is warned and the guard is a no-op.
- **Sandboxed shell.** Destructive, privilege-escalating, and non-local network
  commands are screened out before execution (`src/shell.ts`). The agent runs only
  against a local/test environment.

## Layout

| File                | Responsibility                                            |
| ------------------- | --------------------------------------------------------- |
| `src/loop.ts`       | The agent loop; observation formatting                    |
| `src/shell.ts`      | Command screening + sandboxed execution                   |
| `src/workspace.ts`  | Git-backed write-allowlist enforcement                    |
| `src/parse.ts`      | Extract the one action from a model turn                  |
| `src/model.ts`      | Thin, swappable model boundary (Claude via Vercel AI SDK) |
| `src/prompt.ts`     | System prompt + embedded criteria manual                  |
| `src/config.ts`     | Run configuration + defaults                              |
| `src/verify.ts`     | Trust gates: quarantine + mutation polarity               |
| `src/casebook/`     | The `.qa-agent/` casebook: case ids, cases, state, I/O    |
| `src/index.ts`      | CLI                                                       |
| `.claude/skills/qa` | Sidekick skills: `qa` router, `qa-plan`, `qa-author`      |

## Test

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```
