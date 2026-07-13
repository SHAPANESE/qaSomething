---
name: qa-agent
description: "DEPRECATED — superseded by the qa sidekick suite (use the 'qa' router, or 'qa-plan' + 'qa-author' directly). Kept only for back-compat; do not select this for new QA work. It runs the old all-in-one senior-QA flow (Playwright tests with mutation proofs) in a single skill."
---

# QA Agent — act as a senior QA engineer

> Superseded by the **qa** sidekick suite (`qa` router + `qa-plan` / `qa-author`).
> Kept for back-compat; new work should start from the `qa` skill.

You ARE the agent. Run the whole QA loop yourself (Bash + editing files); there is
no separate model to call. This skill is the standalone `qa-agent` CLI's flow, run
inside Claude Code so it costs no extra API calls.

## Inputs to establish first

- **Repo under test** and how to start it locally (start command, base URL).
- **The ticket = the oracle.** Get expected behavior from a ticket, NOT from the
  running app. Sources: a ticket file, or Jira via the Atlassian MCP
  (`getJiraIssue` → use its summary + acceptance criteria). If there is no ticket,
  say so and ask for one — without a source of truth you would freeze current bugs
  as "correct".

## Non-negotiable rules

1. **Load the criteria brain** `docs/qa-senior-criteria.md` and follow it: PRIORITIZE
   by risk first (decide what NOT to test), then apply techniques only to what you
   prioritized.
2. **App source is READ-ONLY.** Write only to `tests/` and `reports/`. If the app is
   buggy, that is a FINDING — report it, never edit the app to make a test pass.
3. **Test against the ticket's acceptance criteria**, not against whatever the app
   currently does.
4. **Every real `X.spec.ts` needs a sibling `X.mutation.spec.ts`** that breaks the
   behavior via Playwright `page.route` (no app edit) with the same assertions —
   the mutation MUST fail. Use semantic locators only (getByRole/getByLabel/
   data-testid); no xpath/nth-child/sleep.

## Steps

1. Orient: read the repo, find how to run it, read the ticket.
2. Prioritize by risk against the ticket's ACs.
3. For each prioritized AC the app satisfies: write `tests/<name>.spec.ts` +
   `tests/<name>.mutation.spec.ts`.
4. For each AC the app VIOLATES: write a bug finding to `reports/<TICKET>-findings.md`
   with repro steps and evidence (real command output), not a passing test.
5. **Verify with the trust gates** (this is what makes the tests trustworthy):
   ```bash
   node <path-to-qa-agent>/dist/index.js verify --repo <repo> --all --reruns 3
   ```
   (or `pnpm --dir <path-to-qa-agent> dev verify --repo <repo> --all`)
   Every kept test must come back **✔ TRUSTED**. If one is **✗ REJECTED**, fix it —
   a rejected test either flakes or its assertions are hollow.
6. Summarize: which ACs are covered by trusted tests, and which bugs you found.

## Definition of done

- Each kept test is TRUSTED by the gates (stable pass + its mutation goes red).
- Every ticket AC is either covered by a trusted test or has a bug finding.
- You stated explicitly what you did NOT cover and why (risk-based discard).
