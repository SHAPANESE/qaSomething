# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Back-of-cycle stages: `qa-run` (run + coverage), `qa-triage` (failure/flakiness
  classification), `qa-bug` (case-linked findings), `qa-report` (sign-off). Casebook
  gains run records (`runs/`), a flaky registry (`flaky.json`), findings I/O, and the
  `caseTag`/`run`/`flaky`/`report` modules.

### Added

- QA sidekick foundation: `.qa-agent/` casebook module (`src/casebook/`) with a
  stable case-id traceability backbone, `cases.md`/`state.json` parse-serialize,
  and I/O layer.
- `qa` router + `qa-plan` (criterio-driven planning with auditable scenario
  coverage + spec-gap findings) + `qa-author` (authors specs from the casebook).
- `scripts/check-casebook.mts` — validates a produced casebook exercises criterio.
- **Agent engine** — a mini-swe-agent / Webwright-style loop: the model emits one
  shell command per turn, run under guardrails, output fed back until it finishes.
- **Safety guardrails** — sandboxed shell (dangerous-command blocklist, local-only
  network) and a git-backed write-allowlist that keeps app source read-only.
- **Trust gates** — quarantine (re-run N times) + mutation polarity (a sibling
  `*.mutation.spec.ts` must fail), so hollow/flaky tests are rejected.
- **Oracle** — expected behavior derives from a ticket (file or Jira REST), not
  from observing the app.
- **Missions** — generate (#1), auto-repair/self-healing (#2), triage (#6), and a
  3-layer CI gate (#4). The `verify` and `triage` subcommands need no API key.
- **Eval harness** — score whether the gates classify a labeled test set correctly.
- **Per-repo config** — `qa-agent.config.json`, validated with zod.
- **Claude Code skill** — run the flow inside Claude Code on a subscription (no key).
- **Tooling** — ESLint, Prettier, `pnpm check`, CI workflow, and an OSS baseline.

### Fixed

- Command-injection vector in the Playwright runner (argv form, no shell).
- Write-guard and spec discovery now work when the app is a monorepo subdirectory.
- Environment failures (app won't start) are reported as "inconclusive", not blamed
  on the test.
