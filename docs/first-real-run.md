# The first real run — the make-or-break test

Everything so far proves the *machinery*. This is the test that proves (or
disproves) the *idea*: can the LLM agent, unsupervised, write trustworthy tests
against a real app? Until you run this, the project is "promising scaffold", not
"proven". Be skeptical and read the output critically — the goal is honest signal,
not a green checkmark.

## Two ways to run it — pick one

The **API key is separate from your Claude subscription.** A Claude Pro/Max (or
Claude Code) plan does NOT include API credits; `ANTHROPIC_API_KEY` is a
pay-per-token account from console.anthropic.com. So:

- **Path A — inside Claude Code (no API key, uses your subscription).** Invoke the
  `qa-agent` skill and point it at your app + ticket. Claude Code acts as the
  agent's brain and runs the same trust gates. Zero extra token billing. **This is
  the cheapest way to do the make-or-break test — start here.**
- **Path B — standalone CLI (needs `ANTHROPIC_API_KEY`).** Fully autonomous,
  headless, CI-ready — but billed per token via the Anthropic Console. Use this once
  Path A shows the idea works and you want it running unattended.

The prerequisites below (real app, git root, Playwright, a ticket) apply to BOTH.
Only Path B needs the key.

## Prerequisites

1. For Path B only: `export ANTHROPIC_API_KEY=sk-ant-...`
2. A **real app repo** that is:
   - a **git repository at its root** (the write-guard reverts app-source edits by
     git; if the app is a subdir of a monorepo, run against that subdir only if it
     is itself a git root — otherwise the guard's path matching won't line up),
   - runnable locally, with **Playwright installed** (`npm i -D @playwright/test &&
     npx playwright install chromium`).
3. A **ticket** describing expected behavior — a file (`--ticket ./PROJ-1.md`) or a
   Jira key (`--jira PROJ-1` with `JIRA_BASE_URL`/`JIRA_EMAIL`/`JIRA_API_TOKEN`).
   Pick a small, well-specified flow (login, a form, a CRUD screen).

## The command

```bash
pnpm build
node dist/index.js run "Test the login flow" \
  --repo /path/to/your/app \
  --ticket /path/to/PROJ-1.md
# add --model claude-sonnet-5 for a cheaper first run (lower reasoning quality)
```

It will: explore the repo, (try to) start the app, prioritize by risk against the
ticket, write `tests/*.spec.ts` + `*.mutation.spec.ts`, report bugs it finds, then
run the trust gates. App source stays read-only (edits are reverted).

## What to watch WHILE it runs

- **Orientation:** does it actually find how to start the app, or flail?
- **Prioritization:** does it reason about risk, or just test the happy path?
- **Guardrails firing:** `↩ guardrail reverted` = it tried to edit the app (bad
  instinct, correctly stopped). Frequent reverts = it's fighting the read-only rule.
- **Protocol drift:** `⚠ protocol` lines = it's not emitting clean single actions.

## How to JUDGE the result (be harsh)

1. **Read every generated test by hand.** Does it assert real *behavior*, or did it
   settle for "the page loaded"? This is where it most likely disappoints.
2. **Check the mutation proofs.** Open `*.mutation.spec.ts`: does it break the RIGHT
   thing, or a lazy break that fails for the wrong reason? A hollow mutation lets a
   hollow test pass the gate.
3. **Trust-gate verdicts:** how many came back `TRUSTED` vs `REJECTED`? Re-run
   independently: `node dist/index.js verify --repo /path/to/your/app --all`.
4. **Did it find a real bug** (a genuine ticket violation), or invent a false one?
5. **Cost & steps:** note tokens and step count. Is the value worth the spend?

## Where it will most likely struggle (expected)

- **Auth / session / state** — needs test users, seeded data, a clean DB.
- **Complex or dynamic DOMs** — locators get hard; more flaky, more reverts.
- **Starting the app** — non-trivial start commands, env vars, services.
- **The oracle** — if the ticket is vague, it will guess, and guesses encode bugs.

## Interpreting the outcome honestly

- **It produces mostly TRUSTED, meaningful tests + a real finding** → you have
  something real. Double down; expand the eval set with these cases.
- **It writes tests but they're shallow / mostly REJECTED** → the gates are doing
  their job (rejecting junk), but the agent isn't good enough yet. That's still a
  useful result: the *trust gate* is the defensible product; the autonomous agent
  needs work. Consider shipping the gate alone.
- **It flails (can't start the app, endless reverts)** → the harness needs better
  environment config and prompting before autonomy is realistic. Note exactly where
  it broke — that's the roadmap.

Whatever happens, capture the transcript and the generated files. The failure modes
are the most valuable output of this run.
