---
name: qa-bug
description: Use to write up a bug — a clear, evidence-backed finding linked to its case and acceptance criterion, either as a markdown finding or a Jira issue. Triggers on "file this bug", "write up the bug", "report this finding", "log a defect".
---

# qa-bug — write up a bug linked to its case

Turn a confirmed violation (app disagrees with the ticket) into a finding. The oracle
is the ticket, not the app.

## Steps

1. Identify the case (`TC-...`) and its acceptance criterion from `cases.md`.
2. Write `<repo>/.qa-agent/findings/<TICKET>-bug-<n>.md` with: title; linked case id +
   AC; **repro** (exact steps + data); **expected vs actual** (expected from the
   ticket); **evidence** (real command/output, not "I think"); **severity vs
   priority** (they differ). Keep app source untouched.
3. Set that case's `status` to `bug` in `cases.md`.
4. (Optional) If Jira is available (Atlassian MCP), also create the issue and note its
   key in the finding.
5. Report the finding path and the case it's linked to.

## Rules

- One finding = one defect, reproducible, evidence-backed. Never a passing test that
  freezes the bug as "correct".
