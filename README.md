# qa-agent

A senior-QA-minded, SWE-style agent that generates **trustworthy** Playwright tests
— not tests that merely pass.

The engine is deliberately small and mirrors the proven mini-swe-agent / Microsoft
Webwright pattern: one loop, the model emits **one shell command per turn**, we run
it under guardrails, and feed the output back. The differentiator is the layer on
top: a **senior-QA criteria "brain"** (`docs/qa-senior-criteria.md`) plus correctness
and safety guardrails baked in from day one.

See the design in [`docs/superpowers/specs/2026-07-06-qa-agent-design.md`](docs/superpowers/specs/2026-07-06-qa-agent-design.md).

## Status

**Engine: built and tested.** Loop, shell guardrails, git-backed write-allowlist,
model boundary, prompt, and CLI are in place (`pnpm test` → green, `pnpm typecheck`
→ clean).

**Not yet built** (needs two design decisions first — the oracle source and how the
mutation check breaks behavior without touching app source): the automated
mutation-check gate, the quarantine/self-reflection rerun, and the eval harness.

## Install

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-...
```

## Run

```bash
pnpm build
node dist/index.js "Test the login flow" --repo /path/to/your/app
# or, without building:
pnpm dev "Test the login flow" --repo /path/to/your/app
```

Options: `--model <id>`, `--max-steps <n>`, `--timeout <ms>`, `--criteria <path>`.

## Safety model

- **App source is read-only.** The agent may only write to `tests/`, `reports/`,
  and `.qa-agent/`. Any change outside those is reverted after each command via a
  git-backed guard (`src/workspace.ts`). Requires the repo under test to be a git
  repo; otherwise the agent is warned and the guard is a no-op.
- **Sandboxed shell.** Destructive, privilege-escalating, and non-local network
  commands are screened out before execution (`src/shell.ts`). The agent runs only
  against a local/test environment.

## Layout

| File | Responsibility |
|---|---|
| `src/loop.ts` | The agent loop; observation formatting |
| `src/shell.ts` | Command screening + sandboxed execution |
| `src/workspace.ts` | Git-backed write-allowlist enforcement |
| `src/parse.ts` | Extract the one action from a model turn |
| `src/model.ts` | Thin, swappable model boundary (Claude via Vercel AI SDK) |
| `src/prompt.ts` | System prompt + embedded criteria manual |
| `src/config.ts` | Run configuration + defaults |
| `src/index.ts` | CLI |

## Test

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```
