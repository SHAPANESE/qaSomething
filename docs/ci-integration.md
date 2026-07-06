# CI integration — the 3-layer verification gate (Mission #4)

The problem this solves: a non-deterministic LLM agent must NEVER sit on a
pipeline's critical path — it would make CI flaky, and a flaky CI is one nobody
trusts. So the agent is kept off to the side, and only its **output**
(deterministic, trusted tests) gates PRs.

Template workflow: [`docs/ci/qa-gate.yml`](ci/qa-gate.yml) — copy into your app repo.

## The three layers

| Layer | When | What runs | On the critical path? |
|-------|------|-----------|-----------------------|
| **1 — Deterministic suite** | every PR | the trusted Playwright tests (`playwright test`) | ✅ yes — gates the merge |
| **Trust gate** | every PR | `qa-agent verify --all --json` — quarantine + mutation polarity on the tests themselves | ✅ yes — blocks a PR that adds a hollow or flaky test |
| **3 — Triage** | on failure | `qa-agent triage --all` — classify each failure (drift / regression / flaky) | annotation only |
| **2 — Agentic maintenance** | nightly / manual | `qa-agent run … --jira …` generates & maintains tests, opens a PR | ❌ no — off the critical path |

## Why the gate matters

Layer 1 alone tells you the tests **pass**. The trust gate tells you the tests are
**worth passing** — it re-runs each test (quarantine) and runs its mutation proof,
so an always-green or flaky test is rejected *before it merges* instead of rotting
the suite later.

- **Exit code:** `verify` exits non-zero if any test is untrusted → the gate fails
  the PR check.
- **JSON:** `--json` emits per-spec verdicts for dashboards / PR annotations.

## Layer 2 is asynchronous by design

The agent (which needs `ANTHROPIC_API_KEY`) runs nightly or on demand, reads a
ticket as the oracle, generates/maintains tests, and opens a PR. Humans review that
PR; the trust gate on that PR guarantees the generated tests are trustworthy before
they land. The agent never blocks a developer's merge.

## Running the gate locally

```bash
qa-agent verify --repo /path/to/app --all --json   # exit 1 if any test is untrusted
qa-agent triage --repo /path/to/app --all          # why are the failing ones failing?
```
