# Contributing

## Setup

```bash
pnpm install
```

## Development

| Command                               | What it does                                                    |
| ------------------------------------- | --------------------------------------------------------------- |
| `pnpm test`                           | Run the unit suite (vitest)                                     |
| `pnpm typecheck`                      | Type-check with `tsc --noEmit`                                  |
| `pnpm lint`                           | ESLint                                                          |
| `pnpm format`                         | Format with Prettier                                            |
| `pnpm check`                          | Everything above — the gate a PR must pass                      |
| `pnpm exec tsx scripts/dry-run.mts`   | Exercise the real agent loop with a scripted model (no API key) |
| `pnpm exec tsx scripts/run-evals.mts` | Score the trust gates against the eval set                      |

Run `pnpm check` before opening a PR.

## Design principles

- **Lean in features, robust in correctness and safety.** Don't add speculative
  mechanisms; do bake in the guardrails and trust gates.
- **The harness verifies; it doesn't trust the agent's word.** New behavior should
  be enforced and testable, not assumed.
- **Pure core, injected effects.** Keep decision logic pure and unit-tested; inject
  runners/models/fetch so orchestration is testable without a browser or a key.

## Tests

Every non-trivial change needs a test. Pure logic gets a unit test; loop/guardrail
changes should be covered by `scripts/dry-run.mts` or a fixture verification.
