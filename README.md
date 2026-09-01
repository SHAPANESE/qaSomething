# QASomething

Task-driven exploratory QA for web applications. Point it at a local or staging
environment, give it a focused goal and an explicit oracle, and it produces a
reproducible Playwright result with evidence. A ticket is useful context, not a
requirement: its acceptance criteria can be distilled into the task oracle.

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
  "business": {
    "flow": "create",
    "capability": "Create a task",
    "tags": ["crud", "regression"]
  },
  "risk": { "impact": 3, "probability": 2, "areas": ["tasks"] },
  "execution": { "projects": ["Desktop Chrome", "Mobile Chrome"] },
  "attempts": 2,
  "evidence": {
    "required": ["ui", "network", "console", "screenshot"]
  },
  "safety": {
    "allow": ["read", "create_test_data", "modify_test_data", "delete_test_data"],
    "deny": ["external_message", "payment", "user_admin"],
    "maxRequests": 150
  },
  "supervision": {
    "mode": "approve_risky",
    "checkpointBeforeExecution": true,
    "checkpointBeforeFinding": true,
    "reviewer": "qa@example.test"
  }
}
```

`task explore` authors a semantic `sequence.json`. The harness compiles it into
`tests/qa-generated/<task-id>.spec.ts`, captures runtime evidence, repeats it in
clean browser sessions, and minimizes consistently failing sequences.

For a passing task it also compiles a `*.mutation.spec.ts` sibling. The agent
must mutate the behavior at the app boundary (normally with a Playwright route),
and the original oracle must fail on every clean mutation attempt. A task is not
accepted as `verified` when that proof remains green.

Run an existing task spec without an AI model:

```bash
node dist/index.js task run \
  --repo /path/to/app \
  --file qa-tasks/existing-regression.json \
  --json
```

For `task run`, the task must contain repo-relative `spec` and `mutationSpec`
paths. A passing task without its mutation proof is inconclusive, never
`verified`; the runner saves independent mutation attempts beside the normal
ones.
Likewise, a task without an explicit `oracle` can produce exploration evidence,
but cannot be classified as `verified`.

### Business coverage, matrix, and visual regression

Tasks can be classified as `authentication`, `checkout`, `authorization`, CRUD,
`error_handling`, or `regression`. `task catalog` lists the task portfolio in
descending impact × probability order, so CI can prioritize critical flows:

```bash
node dist/index.js task catalog --repo /path/to/app
node dist/index.js task matrix --repo /path/to/app --file qa-tasks/checkout.json
```

`task matrix` runs the same trusted task for every named Playwright project in
`execution.projects` (for example Chromium, Firefox, WebKit, and a mobile
viewport). Every profile must independently pass its clean and mutation runs.
It writes a review-ready matrix report under `.qa-agent/matrix-runs/`.

Structured oracles support URL, visible text, input values, expected network
responses, absence of page errors, and visual baselines. A visual baseline is
intentional and reviewed like any other test fixture:

```json
{ "kind": "visual_snapshot", "name": "checkout.png", "maxDiffPixels": 0 }
```

Bootstrap or approve a new baseline with Playwright's explicit review command,
then commit the resulting `*-snapshots/*.png` file:

```bash
npx playwright test qa-generated/checkout.spec.ts --update-snapshots
```

For APIs, use the existing contract runner against the source OpenAPI/GraphQL
contract; it tests positive and negative generated cases and preserves concrete
reproductions for violations:

```bash
node dist/index.js api --repo /path/to/app --spec openapi.yaml --url https://staging.example.test
```

Sequences may include semantic `cleanup` actions. They execute after screenshot
and evidence capture whether the oracle passes or fails; a cleanup failure turns
an otherwise passing task into a failed run so test data cannot silently leak.
After `task explore`, the replay-ready manifest is written to
`.qa-agent/task-work/<task-id>/task.generated.json`; pass that file directly to
`task run` to rerun the generated spec and its mutation proof.

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
    supervision.json
  task-runs/<run-id>/
    task.json
    attempt-1.log
    attempt-2.log
    result.json
```

## Supervised agentic testing

The mechanical exploration can run autonomously while a QA remains the decision
owner. Enable it in the task's `supervision` block above, or from the CLI:

```bash
node dist/index.js task explore \
  --repo /path/to/app \
  --file qa-tasks/checkout.json \
  --subscription \
  --supervised \
  --reviewer "QA Name"
```

`--supervised` selects `approve_risky`: confidently read-only inspection is
automatic, while executable shell commands require review. The QA also reviews
the final semantic browser sequence before Playwright runs and separately
accepts or rejects a reproducible finding. Use `--approval-mode approve_all` to
review every shell command; `autonomous` preserves the original behavior.

At each checkpoint the reviewer can approve once, approve that risk category
for the session, deny it and let the agent revise, or pause. A paused run exits
without authorizing the operation. Resume it with the same task and options:

```bash
node dist/index.js task resume \
  --repo /path/to/app \
  --file qa-tasks/checkout.json \
  --subscription \
  --supervised
```

The durable `.qa-agent/task-work/<task-id>/supervision.json` records request
hashes, decisions, reviewer identity, notes, timestamps, and automatic/session
approvals. In `--json` mode there is no interactive prompt: a required approval
fails closed by pausing the run. Static command screening, semantic safety, the
write allowlist, repeated verification, mutation proof, and evidence gates still
apply after human approval; approval does not bypass them.

## Safety

- Application source is read-only during agent runs. Git-backed guardrails
  revert agent writes outside the configured directories while preserving work
  that was already dirty.
- Every semantic action has a risk category. Explicit deny wins over allow.
- Payments, external messages, and user administration are denied by default.
- The semantic action's code is screened too: a `read` action cannot disguise a
  payment, an external message, user administration, or navigation to an
  unrelated host. Assertions receive the same screening.
- Agent shell commands may only contain local HTTP URLs. Remote Git operations,
  package installation, and recursive deletion are blocked during a run; install
  dependencies before invoking the agent.
- Blocked or inconclusive tasks return exit code `2`; reproducible behavior
  failures return `1`; verified tasks return `0`.
- Use test or staging environments. Do not point exploratory write tasks at
  production.
- `safety.maxRequests` gives a task an explicit browser-request budget. The
  generated assertion and saved evidence make accidental staging load visible.
- Run artifacts contain clickable attempt logs, a task report, mutation proof,
  risk/business context, and matrix summaries for release review.

## Existing capabilities

The earlier casebook workflow remains available for ticket-oriented planning,
traceability, triage, reporting, mutation gates, and Schemathesis API contract
testing. `pnpm evals` continuously scores the trust gates against labeled,
executable fixture suites. Real agent-quality evaluation additionally requires
a reviewed corpus of product tasks and their expected sequences; the runner
never pretends those labels exist when they do not. Run `node dist/index.js
--help` for all commands.

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
