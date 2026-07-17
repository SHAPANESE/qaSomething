# qa-agent

A QA sidekick you work with inside Claude Code. Give it a web app and a ticket, and it
works the whole QA cycle with you like a senior tester — planning, writing trustworthy
Playwright tests, and standing behind them.

## What it does

1. **Plans what to test — with judgment.** Prioritizes by risk (including what _not_ to
   test) and goes past the happy path: negatives, boundaries, security. If the ticket is
   ambiguous, it flags a **gap** instead of guessing. You review the plan before any test
   code exists.
2. **Writes tests you can trust.** For every real test it also writes a "mutation" test
   that breaks the app on purpose. If the real test still passes when the behavior is
   broken, it asserts nothing and is rejected. A green test really means it catches bugs.
3. **Reports bugs, not false green.** The source of truth is the **ticket**, not the
   running app (copying the app would freeze its current bugs as "correct"). When the app
   breaks the ticket, it files a bug instead of a test that hides it.

Everything lives in a **casebook** (`.qa-agent/` in your repo), linked by a stable case
id so you can trace _this requirement → this case → this test → passed or bug_.

## How to use it

Both ways start from a repo and a ticket.

**As a sidekick, inside Claude Code (no API key).** Just talk to it:

- **"QA this ticket"** → runs the whole cycle with you (plan → author → run → …),
  stopping at each step for your OK.
- **"plan QA for PROJ-42"** → just the risk-ranked plan + flagged gaps, to review first.
- **"author the tests"** → turns the approved plan into trustworthy tests (each with its
  mutation proof).

Nothing is marked "done" unless the trust gates pass. The stages are: **qa** (router) ·
**qa-plan** · **qa-author** · **qa-run** · **qa-triage** · **qa-bug** · **qa-report**.

**As a CLI (for automation / CI).** Uses your Claude Code subscription or an API key:

```bash
pnpm build
node dist/index.js "Test the login flow" --repo /path/to/app --ticket ./PROJ-42.md
# check tests already in a repo, no agent:
node dist/index.js verify --repo /path/to/app --all
```

The `--ticket` file (markdown, text, or JSON) defines the expected behavior — the oracle.
Without it the agent has no source of truth and is warned. Other options: `--subscription`
(no API key), `--model <id>`, `--max-steps <n>`, `--timeout <ms>`, `--skip-verify`.

## The casebook

`.qa-agent/` in the repo under test holds all QA state. Stages are stateless; the
casebook holds state, so you can run the guided flow or jump to any stage à la carte.

| File         | Holds                                                              |
| ------------ | ------------------------------------------------------------------ |
| `plan.md`    | risk-ranked plan: what to test, what was discarded, why            |
| `cases.md`   | test cases with a stable id, AC, priority, and scenario category   |
| `gaps.md`    | spec ambiguities / undefined edge cases (findings before any test) |
| `runs/`      | per-run records mapping each case to its test result               |
| `flaky.json` | flakiness registry from triage                                     |
| `findings/`  | case-linked bug write-ups (markdown, or filed as a Jira issue)     |
| `report.md`  | sign-off summary: covered / not covered / gaps / bugs              |
| `state.json` | each ticket's position in the cycle (planned → … → reported)       |

## Safety model

- **App source is read-only.** The agent may only write to `tests/`, `reports/`, and
  `.qa-agent/`. Any change outside those is reverted after each command via a git-backed
  guard. (Requires the repo under test to be a git repo.)
- **Sandboxed shell.** Destructive, privilege-escalating, and non-local network commands
  are screened out before execution. The agent runs only against a local/test environment.

## Install / Run / Test

```bash
pnpm install     # no API key needed for the sidekick skills or trust gates
pnpm build
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

See the full design in
[`docs/superpowers/specs/2026-07-06-qa-agent-design.md`](docs/superpowers/specs/2026-07-06-qa-agent-design.md).
