# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **API contract testing (Schemathesis).** New `api` CLI subcommand contract-tests
  a running API against its OpenAPI/GraphQL spec — the spec is the oracle, a
  violation is a finding (the API-layer analogue of the Playwright trust gates).
  Adds the `src/api/schemathesis.ts` module (pure JUnit parser + run interpreter +
  arg builder + injectable runner), a `contract` scenario category, and wires the
  contract path through the `qa-plan`/`qa-author`/`qa-run`/`qa-triage` skills.
  Proven end-to-end on `fixtures/task-app`: it auto-finds the planted AC3 boundary
  bug (server accepts a title past the contract's `maxLength`) with no hand-written
  case. Uses `uvx schemathesis` (override with `SCHEMATHESIS_BIN`).
- Back-of-cycle stages: `qa-run` (run + coverage), `qa-triage` (failure/flakiness
  classification), `qa-bug` (case-linked findings), `qa-report` (sign-off). Casebook
  gains run records (`runs/`), a flaky registry (`flaky.json`), findings I/O, and the
  `caseTag`/`run`/`flaky`/`report` modules.
- `report` CLI subcommand — `qa-agent report --repo <path>` renders the sign-off to
  `.qa-agent/report.md` and advances the ticket to the `reported` phase (a
  first-class deterministic hand for the `qa-report` skill).
- QA sidekick foundation: `.qa-agent/` casebook module (`src/casebook/`) with a
  stable case-id traceability backbone, `cases.md`/`state.json` parse-serialize,
  and I/O layer.
- `qa` router + `qa-plan` (criterio-driven planning with auditable scenario
  coverage + spec-gap findings) + `qa-author` (authors specs from the casebook).
- `scripts/check-casebook.mts` — validates a produced casebook exercises criterio.
- Second fixture app + eval (`fixtures/task-app`, `evals/task-app.eval.json`) — an
  add-task form with a planted 80-char boundary bug, proving the trust gates and
  mutation-polarity check generalize beyond the login flow (eval: 3/3).
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

### Changed

- Trust gates and triage now read Playwright's `--reporter=json` instead of scraping
  the human line reporter, so pass/fail counts and failure classification no longer
  break when Playwright changes its console formatting. The line-reporter parser is
  kept as a fallback for runs that never produce a JSON report (environment failures).

### Fixed

- Triage now recognizes `Expected string:` / `Expected pattern:` matcher output (e.g.
  `toHaveText`), so a real behavior regression is no longer misclassified as
  locator-drift when the failure message also mentions a timeout.
- `renderReport` strips a leading heading from embedded `gaps.md` so the sign-off no
  longer nests a top-level heading under its `## Spec gaps` section.
- Command-injection vector in the Playwright runner (argv form, no shell).
- Write-guard and spec discovery now work when the app is a monorepo subdirectory.
- Environment failures (app won't start) are reported as "inconclusive", not blamed
  on the test.
- A missing Playwright runner is now detected as "inconclusive" on Windows too
  (`'playwright' is not recognized …`) and via execa's `spawn … ENOENT`, so a broken
  setup is no longer misreported as a genuine test failure.
