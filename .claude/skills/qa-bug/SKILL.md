---
name: qa-bug
description: Write up a confirmed bug in the six fixed sections — Description, Steps to reproduce, Actual, Expected, Evidence, RCA — with the capture inline and the RCA permalinked to the repo. Nothing else, kept simple. Runs the pre-filing gates first. Triggers on "file this bug", "write up the bug", "report this finding", "log a defect", "raise this".
---

# qa-bug — write up a bug linked to its case

Turn a confirmed violation (app disagrees with the ticket) into a finding. The oracle is the
ticket, not the app.

Validity, reachability and user impact are decided in `qa-adjudicate`, not here — arrive with the
rung and the cost already derived. If you do not have them, that skill runs first.

## Steps

1. Identify the case (`TC-...`) and its acceptance criterion from `cases.md`.
2. Run **Gates**. If one fails, either fix the finding or drop it — say which.
3. Capture and annotate the evidence — see **Capturing the evidence**. Save it into
   `<casebook>/findings/` so the citation in the report points at a file that exists.
4. Write `<casebook>/findings/<TICKET>-bug-<n>.md` — see **The format**, **Length** and
   **Writing the Evidence section**.
5. Run **the delete pass**.
6. Set that case's `status` to `bug` in `cases.md`.
7. Post it to the tracker (Linear via MCP, or Jira) **only after the user confirms**, then attach
   the capture. Write it in English even when the working conversation is in another language.
8. Report the finding path, the case it links to, and the comment id if posted.

## Gates — run these BEFORE writing anything up

Each of these has killed a real finding. Skipping them is how a bug gets bounced.

1. **Is it already raised?** Search the ticket thread for the mechanism, not just the title.
   Someone may have raised it, or business may have already ruled on it.
2. **Has business already accepted it?** A behaviour ruled "working as intended" is not a bug,
   however wrong it looks. If tempted to argue the ruling covers a narrower case than it says,
   that distinction is usually too fine — drop it.
3. **Is it caused by the change under test?** `git grep` the mechanism on the branch and on
   `main`. Zero hits on main = new. Present on both = pre-existing, file it elsewhere and say so.
4. **Is it reachable on real, unseeded data?** Count the affected rows in a live payload or with
   SQL. A defect that only exists under seeding gets deprioritised, correctly. State the number.
5. **Does the evidence exist on disk?** Open the file you are about to cite. A finding citing a
   screenshot that was never written is worse than one with no screenshot.
6. **Is the mechanism you are blaming the one that actually runs?** Reading a function definition
   is not establishing which branch is live. Commented-out SQL and dead helpers have both been
   quoted as proof here before.

## The format

Six sections, exactly these, in this order: **Description, Steps to reproduce, Actual,
Expected, Evidence, RCA**. **Actual comes before Expected** — the reader meets the defect
first, then the rule it broke. There is no seventh section and none of the six is optional.

Read `references/bug-format.md` for the template and for how to shape an RCA (it is a
permalink pinned to the sha under test, not a citation). If `LOCAL.md` sits next to this
file, read it too: it names the project's approved reference ticket.

Evidence is a tangible artefact and nothing else — an image, a console excerpt, a payload, a
query result. Never a provenance line, never your method. Read `references/evidence.md`
before writing that section.

When you are ready to capture and post, read `references/capture-and-post.md` — the annotated
capture and the Linear upload are both already-written tools with traps that have bitten.

## Section allowlist — anything that is not one of these is deleted

The six are Description, Steps to reproduce, Actual, Expected, Evidence, RCA. Anything else gets
deleted — Severity, Impact, Affected endpoints, Scope, Frequency, Notes, Related, Suggested fix,
Workaround, Analysis, Methodology, "for anyone retesting", or a second table.

Where the cut content goes instead:

- **Severity / impact / frequency** → one clause inside Description ("Low — authenticated only,
  no data exposure beyond reconnaissance").
- **Affected list (endpoints, screens, rows)** → one line inside Evidence, names only, no table.
- **Suggested fix** → one clause inside RCA, or nothing. The fix is the developer's call.
- **Related tickets** → a Linear relation, not a paragraph.
- **How it was found** → the casebook. It is not evidence, and it is not a section. Only name a
  tool in Evidence when the reader needs it to re-run the artefact you pasted.

## Length and readability — use the numbers, not your taste

- Whole report: **one screen.** If it needs scrolling, it is over budget.
- Description: **three sentences maximum**, and the severity clause is one of them.
- Steps: **5 maximum**, one line each.
- **One table maximum**, and only if a row-by-row comparison is the fastest way to show the defect.

These four come from what gets bounced here. The next four are the plain-language consensus, and
they are measurable — check them instead of guessing:

- **Sentences average ~15 words, never over 25.** Long sentences are where a reader stops parsing.
- **One point per paragraph, 3–5 sentences at most.** If a paragraph makes two points, it is two
  paragraphs.
- **Front-load.** The first sentence of a section says what the section is about; the words the
  reader is scanning for go at the start of the line, not buried mid-sentence.
- **Prefer a list to a paragraph** whenever the content is more than two parallel facts. This is
  why Evidence is lines.

A long bug report gets skimmed and argued. A short one gets fixed.

Sources: [Style Manual (AU) — plain language](https://www.stylemanual.gov.au/style-manual-resources/quick-guides/quick-guide-plain-language),
[ONS Service Manual — plain language](https://service-manual.ons.gov.uk/content/writing-for-users/plain-language),
[Colorado OIT — how to use plain language](https://oit.colorado.gov/accessibility/how-to-use-plain-language).

## Before you post — the delete pass

Reread the draft and cut, in this order:

1. Every heading not on the allowlist.
2. Every code block that is not the Actual value or the repro command.
3. Every sentence that explains your reasoning rather than the defect.
4. Every sentence a developer would delete before forwarding it.
5. Every paragraph in Evidence over two lines long — break it into one fact per line, or cut it.
6. Every clause defending the finding against an objection nobody raised.

If the draft did not get shorter in this pass, you did not do it. Then read the draft as a wall:
if any section is one dense block instead of scannable lines, reformat before posting, not after
the user asks.

## Rules

- One finding = one defect, reproducible, evidence-backed. Never a passing test that freezes the
  bug as "correct".
- **Do not state a finding count before each one has survived the gates.** First-pass counts
  inflate roughly 10:1. Give the number after review, not before.
- Say the severity honestly, including when it is low. "Valid but minor, ~0.01% of rows, not a
  stop-the-push item" is more useful than inflating it — one clause, in Description.
- Separate measured from inferred. If a claim is inferred from a diff, label it and say why it
  could not be verified.
- If a finding is retracted, retract it in the same place it was raised, with the measurement that
  killed it — not an apology.

## Hard-won rules (from past runs)

- Linear tickets, comments and findings are always English, even when the chat is Spanish.
- Comments run about 8-10 lines. Keep the evidence and the ask, cut the rest.
- To attach an image: prepare, `curl PUT` with every signed header, finalize, then embed the bare `assetUrl` as markdown.
