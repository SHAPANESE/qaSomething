# qa-agent

A senior-QA-minded, SWE-style agent that generates **trustworthy** Playwright tests
— not tests that merely pass.

## What it does

You point it at a web app and a **ticket** (the acceptance criteria / expected
behavior). It then acts like a senior QA engineer:

1. **Explores the app** and writes end-to-end [Playwright](https://playwright.dev)
   tests for the behavior the ticket describes.
2. **Proves each test is real, not hollow.** For every `login.spec.ts` it also
   writes a `login.mutation.spec.ts` that deliberately breaks the app's behavior
   (via network interception — it never touches your app's source). The harness then
   requires the real test to **PASS** and the mutation test to **FAIL**. A test that
   still passes when the behavior is broken is a test that asserts nothing — so it's
   rejected.
3. **Reports bugs, not false green.** Expected behavior comes from the ticket, never
   from watching the app run. That distinction matters: if the agent learned "correct"
   by observing the app, it would enshrine current bugs as expected behavior. When the
   app violates the ticket, the agent flags a bug instead of writing a test that
   accommodates it.

The result is a suite of tests you can trust: each one is backed by a proof that it
actually catches the regression it claims to catch.

**Why an agent and not a script:** the engine is deliberately small and mirrors the
proven mini-swe-agent / Microsoft Webwright pattern — one loop, the model emits **one
shell command per turn**, we run it under guardrails, and feed the output back. The
differentiator is the layer on top: a **senior-QA criteria "brain"**
(`docs/qa-senior-criteria.md`) plus correctness and safety guardrails baked in from
day one.

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

**Engine + trust gates: built and tested** (`pnpm test` → 47 green, `pnpm typecheck`
→ clean). In place: the loop, shell guardrails, git-backed write-allowlist, model
boundary, prompt, CLI, the **oracle** (ticket-derived source of truth), and the
harness-enforced **trust gates** — quarantine (re-run N times) + mutation polarity.

**Oracle = tickets.** Expected behavior derives from a `--ticket`, not from
observing the app (which would freeze current bugs as "correct").

**Mutation check.** For each `X.spec.ts` the agent writes a sibling
`X.mutation.spec.ts` that breaks behavior via `page.route` (no app-source edit).
The harness runs both and requires real→PASS, mutation→FAIL; a hollow test is
rejected.

**Also built:**

- **Eval harness** (`src/eval.ts`, `evals/*.eval.json`) — scores whether the trust
  gates classify a labeled test set correctly. Fixture eval: 3/3.
- **`verify` subcommand** — `qa-agent verify --repo <path> --all` runs the gates on
  existing tests, no agent.
- **Claude Code skill** (`.claude/skills/qa-agent/`) — run the whole flow inside
  Claude Code, no API cost.
- **Jira oracle** — `run --jira <KEY>` (needs `JIRA_BASE_URL`/`JIRA_EMAIL`/
  `JIRA_API_TOKEN`); the skill uses the Atlassian MCP instead.
- **Mission #2 — auto-repair** — `run --repair`: re-anchors drifted locators without
  weakening assertions (demonstrated on the fixture).

**Not yet built:** element caching (Stagehand-style, cost), Missions #3–#6. A live
agent run still needs `ANTHROPIC_API_KEY`; the Claude Code skill needs neither.

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

## Safety model

- **App source is read-only.** The agent may only write to `tests/`, `reports/`,
  and `.qa-agent/`. Any change outside those is reverted after each command via a
  git-backed guard (`src/workspace.ts`). Requires the repo under test to be a git
  repo; otherwise the agent is warned and the guard is a no-op.
- **Sandboxed shell.** Destructive, privilege-escalating, and non-local network
  commands are screened out before execution (`src/shell.ts`). The agent runs only
  against a local/test environment.

## Layout

| File               | Responsibility                                            |
| ------------------ | --------------------------------------------------------- |
| `src/loop.ts`      | The agent loop; observation formatting                    |
| `src/shell.ts`     | Command screening + sandboxed execution                   |
| `src/workspace.ts` | Git-backed write-allowlist enforcement                    |
| `src/parse.ts`     | Extract the one action from a model turn                  |
| `src/model.ts`     | Thin, swappable model boundary (Claude via Vercel AI SDK) |
| `src/prompt.ts`    | System prompt + embedded criteria manual                  |
| `src/config.ts`    | Run configuration + defaults                              |
| `src/index.ts`     | CLI                                                       |

## Test

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```
