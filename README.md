# QASomething

Task-driven exploratory QA for web applications. Point it at a local or staging
environment, give it a focused goal, and it produces a reproducible Playwright
result with evidence. A ticket is useful context, not a requirement.

QASomething uses an AI coding loop to explore, but a deterministic harness owns
the verdict. The model cannot turn `done` into a green check by itself.

## Product flow

```text
goal or ticket
  → semantic QA task
  → Playwright probes
  → semantic action sequence
  → safety gate
  → generated final spec
  → repeated clean execution
  → evidence gate
  → minimized reproduction
  → classified result
```

Final classifications are `verified`, `confirmed_bug`, `probable_bug`,
`blocked`, `environment_issue`, or `insufficient_evidence`.

## Quick start

Requirements: Node 22+, pnpm, Git, Playwright, and either Claude Code or an
Anthropic API key.

```bash
pnpm install
pnpm build

node dist/index.js init \
  --repo /path/to/app \
  --url http://localhost:3000 \
  --start-command "npm run dev"

node dist/index.js task explore \
  --repo /path/to/app \
  --file qa-tasks/first-look.json \
  --subscription
```

Use `--auth storage-state.json` during `init` to copy an existing Playwright
authenticated session into the ignored `.qa-agent/auth/` directory.

## QA tasks

A task is deliberately small and auditable:

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
  "attempts": 2,
  "evidence": {
    "required": ["ui", "network", "console", "screenshot"]
  },
  "safety": {
    "allow": ["read", "create_test_data", "modify_test_data", "delete_test_data"],
    "deny": ["external_message", "payment", "user_admin"]
  }
}
```

`task explore` authors a semantic `sequence.json`. The harness compiles it into
`tests/qa-generated/<task-id>.spec.ts`, captures runtime evidence, repeats it in
clean browser sessions, and minimizes consistently failing sequences.

Run an existing task spec without an AI model:

```bash
node dist/index.js task run \
  --repo /path/to/app \
  --file qa-tasks/existing-regression.json \
  --json
```

For `task run`, the task must contain a repo-relative `spec`.

## Example: finding a duplicate-submit bug

Imagine a task form in staging. A normal click works, but a fast double click
may create two records. You create a focused task:

```json
{
  "version": 1,
  "id": "task-double-submit",
  "goal": "Try to create one task twice with a double submit",
  "target": { "baseUrl": "https://staging.example.test" },
  "oracle": "One user submission creates exactly one task.",
  "attempts": 3,
  "evidence": { "required": ["ui", "network", "screenshot"] },
  "safety": {
    "allow": ["read", "create_test_data", "delete_test_data"],
    "deny": ["external_message", "payment", "user_admin"]
  }
}
```

Run it:

```bash
node dist/index.js task explore \
  --repo . \
  --file qa-tasks/task-double-submit.json \
  --subscription
```

The agent explores with disposable Playwright probes and records semantic
actions such as `navigate`, `fill-title`, `open-help`, and `double-submit`. The
harness then:

1. Rejects any action outside the task safety policy.
2. Compiles the sequence into a normal Playwright spec.
3. Executes it three times in clean browser sessions.
4. Confirms that two `POST /api/tasks` requests and two visible tasks occur.
5. Removes irrelevant steps such as `open-help` and reproduces the same failure.
6. Returns a non-zero exit code with a minimal test, network evidence, and
   screenshots.

Example result:

```text
FAILED task-double-submit (confirmed_bug)
  reproduced: 3/3
  expected task delta: 1
  actual task delta: 2
  network: POST /api/tasks ×2
  minimized: removed open-help
  final spec: tests/qa-generated/task-double-submit.spec.ts
```

If the same sequence passes every time, the result is `verified`. If runs are
mixed, the app cannot start, or required evidence is missing, QASomething
returns `inconclusive` instead of reporting a false green or an invented bug.

## Evidence and trust

Instrumented task specs capture:

- Whether the oracle assertion was reached.
- Network method, URL, and response status.
- Browser console warnings and errors.
- Unhandled page errors.
- Final URL and page title.
- A final full-page screenshot and Playwright attachment.
- Raw output for every independent attempt.

Missing required evidence is `inconclusive`, never passing. Mixed outcomes are
also inconclusive. A reproducible failure is only `confirmed_bug` when the task
has an explicit oracle; otherwise it remains `probable_bug`.

Artifacts live under:

```text
.qa-agent/
  auth/
  task-work/<task-id>/
    task.json
    sequence.json
    sequence.min.json
    trajectory.json
  task-runs/<run-id>/
    task.json
    attempt-1.log
    attempt-2.log
    result.json
```

## Safety

- Application source is read-only during agent runs. Git-backed guardrails
  revert agent writes outside the configured directories while preserving work
  that was already dirty.
- Every semantic action has a risk category. Explicit deny wins over allow.
- Payments, external messages, and user administration are denied by default.
- Blocked or inconclusive tasks return exit code `2`; reproducible behavior
  failures return `1`; verified tasks return `0`.
- Use test or staging environments. Do not point exploratory write tasks at
  production.

## Existing capabilities

The earlier casebook workflow remains available for ticket-oriented planning,
traceability, triage, reporting, mutation gates, and Schemathesis API contract
testing. Run `node dist/index.js --help` for all commands.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

The product boundary is intentionally local and reviewable: Playwright is the
execution engine, files are the durable state, and no cloud dashboard is
required.
