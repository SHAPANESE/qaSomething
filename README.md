# QASomething

**Exploratory QA for web apps that cannot lie to you.**

You give it a goal and the rule that must hold ("one submit creates exactly one
task"). An AI agent explores the app in a real browser, and a deterministic
harness turns what it found into a plain Playwright test, runs it again in clean
sessions, and decides the verdict from evidence.

> The model explores. The harness decides. The agent cannot turn "done" into a
> green check by itself.

Every result is either backed by a reproducible spec, network log and screenshot,
or it is reported as `inconclusive`. No false greens, no invented bugs.

## What do you want to do?

| I want to…                                                     | Use                                                 |
| -------------------------------------------------------------- | --------------------------------------------------- |
| Check one flow or hunt one bug                                 | [`task explore`](#quick-start)                      |
| Re-run a task spec in CI, no AI                                | `task run`                                          |
| Test a whole feature from its acceptance criteria              | [`feature test`](#test-a-whole-feature)             |
| Run the same task on several browsers / viewports              | `task matrix`                                       |
| Contract-test an API from its OpenAPI / GraphQL spec           | `api`                                               |
| Work a ticket end to end: plan → tests → run → bugs → sign-off | [Casebook workflow](#casebook-workflow-for-tickets) |

## Quick start

Requirements: Node 22+, pnpm, Git, Playwright, and either Claude Code
(`--subscription`) or an Anthropic API key.

```bash
pnpm install && pnpm build

# 1. Point it at your app once
node dist/index.js init \
  --repo /path/to/app \
  --url http://localhost:3000 \
  --start-command "npm run dev"
```

Pass `--auth storage-state.json` to `init` to reuse a logged-in Playwright
session. It is copied into `.qa-agent/auth/`, which ignores itself in Git.

```jsonc
// 2. Describe one thing to check: qa-tasks/double-submit.json
{
  "version": 1,
  "id": "task-double-submit",
  "goal": "Try to create one task twice with a double submit",
  "target": { "baseUrl": "https://staging.example.test" },
  "oracle": "One user submission creates exactly one task.",
  "attempts": 3,
}
```

```bash
# 3. Let it explore
node dist/index.js task explore \
  --repo /path/to/app \
  --file qa-tasks/double-submit.json \
  --subscription
```

## What a run looks like

The agent explores with throwaway Playwright probes and records the actions it
took: `navigate`, `fill-title`, `open-help`, `double-submit`. Then the harness
takes over:

1. Rejects any action outside the task's safety policy.
2. Compiles the actions into a normal Playwright spec.
3. Runs it 3 times in clean browser sessions.
4. Sees two `POST /api/tasks` and two visible tasks.
5. Drops steps that don't matter (`open-help`) and checks the bug still reproduces.
6. Exits non-zero with the minimal spec, network evidence and screenshots.

```text
FAILED task-double-submit (confirmed_bug)
  reproduced: 3/3
  expected task delta: 1
  actual task delta: 2
  network: POST /api/tasks ×2
  minimized: removed open-help
  final spec: tests/qa-generated/task-double-submit.spec.ts
```

The final spec is plain Playwright. Commit it and it is a regression test.

## How the verdict is decided

```text
goal ─▶ agent explores ─▶ action sequence ─▶ safety gate ─▶ Playwright spec
     ─▶ repeated clean runs ─▶ evidence gate ─▶ minimized repro ─▶ verdict
```

| Verdict                 | Means                                                            | Exit code |
| ----------------------- | ---------------------------------------------------------------- | --------- |
| `verified`              | Passed every run, and the mutation proof failed (see below)      | `0`       |
| `confirmed_bug`         | Fails the explicit oracle on every run                           | `1`       |
| `probable_bug`          | Fails on every run, but the task has no explicit oracle          | `1`       |
| `blocked`               | The agent could not reach the oracle and recorded why            | `2`       |
| `insufficient_evidence` | Required evidence missing, no oracle, or no valid mutation proof | `2`       |
| `environment_issue`     | An attempt could not execute, or runs disagreed (flaky)          | `2`       |

**Mutation proof.** A passing test is only trusted if it can fail. For every
passing task the agent also writes a `*.mutation.spec.ts` that breaks the
behavior at the app boundary (normally with a Playwright route). The original
oracle must fail on every mutated run, _after reaching the assertion_. If the
mutated run crashes earlier, or stays green, the task is `inconclusive`, never
`verified`.

**Evidence.** Every attempt captures whether the oracle was reached, network
method/URL/status, console warnings and errors, unhandled page errors, final URL
and title, a full-page screenshot, and raw output.

## Test a whole feature

`feature test` turns acceptance criteria into a small, risk-based campaign:
happy path, negative, boundary, authorization, regression, visual, API-contract
or manual-review scenarios. The harness rejects a plan that skips an acceptance
criterion. With `--supervised`, a QA approves the plan before anything runs.

```bash
node dist/index.js feature test \
  --repo /path/to/app \
  --file qa-features/checkout-coupon.json \
  --subscription --supervised   # add --plan-only to review the plan first
```

Browser scenarios use the same gates as `task explore`. API scenarios go to
Schemathesis when `feature.api` gives a contract and URL. Security scenarios
exercise product permissions and validation; they are not a pentest.

Results go to `.qa-agent/feature-runs/` (`plan.json`, `result.json`,
`report.md`). Campaign states: `passed`, `failed`, `inconclusive`, `paused`,
`needs_review`. Full file format in [Reference](#feature-file).

## Casebook workflow (for tickets)

For ticket work, the Claude Code skills in `.claude/skills/` drive a full cycle
over a casebook in `.qa-agent/` (`cases.md`, `gaps.md`, `runs/`). Start with
`qa` and it walks the stages with a checkpoint after each, or call one stage
directly:

| Skill       | Does                                                    | CLI equivalent        |
| ----------- | ------------------------------------------------------- | --------------------- |
| `qa-plan`   | Ticket → risk-ranked cases + spec gaps                  | —                     |
| `qa-author` | Cases → Playwright specs, each with a mutation proof    | `run --ticket`        |
| `qa-run`    | Runs specs, records results per case, updates coverage  | `verify` (gates only) |
| `qa-triage` | Failing test → flaky, locator drift, or real regression | `triage`              |
| `qa-bug`    | Writes up a confirmed bug with evidence and RCA         | —                     |
| `qa-report` | Sign-off: covered, not covered and why, gaps, bugs      | `report`              |

The ticket's acceptance criteria are the oracle at every stage: a test is judged
against what the ticket says, not against what the app happens to do.

Live-browser skills that write no test code:

| Skill           | Does                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `qa-manual`     | Executes casebook cases by hand in the browser, with evidence per verdict |
| `qa-explore`    | One charter-bounded exploratory session with a hard action budget         |
| `qa-adjudicate` | Decides if a candidate is real, reachable and costly before it is filed   |
| `qa-explain`    | Walks a feature live and marks each element on screen to explain it       |

Project-specific notes (hosts, domain map, reference tickets) go in a
`LOCAL.md` next to a skill's `SKILL.md`. The skill reads it when present, and
Git ignores it so client details never reach this repo.

## Supervised mode

Exploration can run on its own while a QA stays the decision owner:

```bash
node dist/index.js task explore --repo /path/to/app \
  --file qa-tasks/checkout.json --subscription \
  --supervised --reviewer "QA Name"
```

- Read-only inspection runs automatically. Shell commands need approval
  (`--approval-mode approve_all` reviews every one; `autonomous` reviews none).
- The QA reviews the final action sequence before Playwright runs it, and
  accepts or rejects each reproducible finding.
- At each checkpoint: approve once, approve the category for the session, deny
  (the agent revises), or pause. Resume with `task resume` and the same options.
- With `--json` there is no prompt: a needed approval pauses the run.

Decisions are logged in `.qa-agent/task-work/<task-id>/supervision.json`. Human
approval never bypasses the safety, repetition, mutation or evidence gates.

## Safety

- **App source is read-only during runs.** Git-backed guardrails revert agent
  writes outside the allowed directories and keep work that was already dirty.
- **Risky actions are denied by default:** payments, external messages, user
  administration. Every action has a risk category, and deny beats allow. The
  action's code is screened too, so a "read" that pays or navigates to another
  host is rejected.
- **Shell commands are restricted:** local HTTP URLs only; no remote Git,
  package installs or recursive deletes. Install dependencies before a run.
- **Secrets stay out:** agent commands and generated specs run without
  environment variables that look like secrets (`*KEY*`, `*TOKEN*`, `AWS_*`,
  `DATABASE_URL`…). In `--subscription` mode the inner `claude -p` has no tools
  and no MCP servers.
- **Request budget:** `safety.maxRequests` caps browser requests per task.
- **Use test or staging.** Never point exploratory write tasks at production.

These are pattern-based guardrails, not a sandbox. A prompt-injected agent can
get around them (for example, with a URL built at runtime). For real isolation,
run it in a container with no secrets and egress limited to the app under test.

## Reference

### Task file

```json
{
  "version": 1,
  "id": "create-task",
  "goal": "Create a task and verify it persists after reload",
  "target": {
    "baseUrl": "http://localhost:3000",
    "actor": "editor",
    "storageState": ".qa-agent/auth/default.json"
  },
  "oracle": "One submission creates exactly one persistent task.",
  "business": { "flow": "create", "capability": "Create a task", "tags": ["crud", "regression"] },
  "risk": { "impact": 3, "probability": 2, "areas": ["tasks"] },
  "execution": { "projects": ["Desktop Chrome", "Mobile Chrome"] },
  "attempts": 2,
  "evidence": { "required": ["ui", "network", "console", "screenshot"] },
  "safety": {
    "allow": ["read", "create_test_data", "modify_test_data", "delete_test_data"],
    "deny": ["external_message", "payment", "user_admin"],
    "maxRequests": 150
  },
  "supervision": {
    "mode": "approve_risky",
    "checkpointBeforePlan": true,
    "checkpointBeforeExecution": true,
    "checkpointBeforeFinding": true,
    "reviewer": "qa@example.test"
  }
}
```

- No `oracle` → the task can gather evidence but can never be `verified`.
- Sequences may include `cleanup` actions. They run after evidence capture,
  pass or fail; a failed cleanup fails the run so test data cannot leak silently.
- Structured oracles check URL, visible text, input values, network responses,
  absence of page errors, and visual baselines:
  `{ "kind": "visual_snapshot", "name": "checkout.png", "maxDiffPixels": 0 }`.
  Approve a baseline with `npx playwright test <spec> --update-snapshots` and
  commit the `*-snapshots/*.png`.

### Feature file

```json
{
  "version": 1,
  "id": "checkout-coupon",
  "goal": "Apply a coupon during checkout",
  "context": "Coupons may be valid, expired, or owned by another customer.",
  "acceptanceCriteria": [
    { "id": "ac-1", "text": "A valid coupon updates the order total" },
    { "id": "ac-2", "text": "An expired coupon is rejected" },
    { "id": "ac-3", "text": "A customer cannot use another customer's coupon" }
  ],
  "target": { "baseUrl": "http://localhost:3000", "actor": "customer" },
  "risk": { "impact": 5, "probability": 3, "areas": ["checkout", "pricing"] },
  "coverage": {
    "e2e": "required",
    "api": "auto",
    "visual": "auto",
    "security": "required",
    "matrix": ["chromium", "Mobile Chrome"]
  },
  "attempts": 2,
  "safety": {
    "allow": ["read", "create_test_data", "delete_test_data"],
    "deny": ["external_message", "payment", "user_admin"]
  },
  "supervision": {
    "mode": "approve_risky",
    "checkpointBeforePlan": true,
    "checkpointBeforeExecution": true,
    "checkpointBeforeFinding": true,
    "reviewer": "QA Name"
  }
}
```

A plan that ignores a `required` coverage area or uses a `skip`ped one is
rejected. `coverage.matrix` replays verified browser specs on each profile.

### Commands

```bash
# Re-run a task without AI. Needs repo-relative `spec` and `mutationSpec`;
# after `task explore`, pass .qa-agent/task-work/<id>/task.generated.json.
node dist/index.js task run --repo . --file qa-tasks/regression.json --json

# List tasks by impact × probability, so CI runs critical flows first
node dist/index.js task catalog --repo .

# Same task on every project in execution.projects; each must pass clean + mutation
node dist/index.js task matrix --repo . --file qa-tasks/checkout.json

# API contract testing with Schemathesis (positive and negative generated cases)
node dist/index.js api --repo . --spec openapi.yaml --url https://staging.example.test
```

Run `node dist/index.js --help` for everything else.

### Where files go

```text
.qa-agent/
  auth/                    # copied storage state, Git-ignored, chmod 600
  task-work/<task-id>/     # task.json, sequence.json, sequence.min.json,
                           # trajectory.json, supervision.json
  task-runs/<run-id>/      # task.json, attempt-N.log, result.json
  feature-runs/            # plan.json, result.json, report.md
  matrix-runs/             # per-profile matrix report
tests/qa-generated/        # final specs and their *.mutation.spec.ts
```

## Development

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm evals   # scores the trust gates against labeled fixture suites
```

Playwright is the execution engine, files are the durable state, and there is
no cloud dashboard: everything stays local and reviewable.
