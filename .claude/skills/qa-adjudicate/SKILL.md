---
name: qa-adjudicate
description: Decide whether a candidate finding is a real defect, whether a user can reach it through the product, and what it costs them — before anything is written up. Produces one verdict per candidate: ticket, PR comment, report note, or drop. Triggers on "is this a real bug", "are these valid", "would the user hit this", "how does this impact the user", "which of these do I file", "adjudicate these findings".
---

# qa-adjudicate — is it real, can they reach it, what does it cost

Runs between *observing something* and *writing it up*. `qa-bug` assumes a finding already
survived; this is the stage where it survives or dies.

Do not restate `qa-bug`'s gates here — already-raised, business-accepted, pre-existing,
unseeded-data, evidence-on-disk, mechanism-actually-runs all belong there. This skill asks the
three questions those gates do not:

1. **Is it real** — what else would explain it?
2. **Can a user reach it** — what in the product leads them there?
3. **What does it cost** — what do they do differently because of it?

Answer them in that order. A candidate that fails Q1 is never worth answering Q2 and Q3 for, and
a candidate whose rung you have not proven has no severity yet — only a story about one.

## Q1 — Is it real? Kill your own explanation first.

State the finding as a claim. Then write the **most boring alternative explanation that would make
it not a bug**, and go kill that one before you defend the claim. If you cannot name an
alternative, you do not yet understand the mechanism well enough to file.

The alternatives that have actually killed findings here:

- **It is by design for this account.** A demo account named "… ALL" looked like a cross-tenant
  leak until its own record list came back 2,082 rows deep and every row was its own tenant. Names
  lie; entitlement data does not.
- **It is your own filter.** A reconciliation gap is usually the null/zero rows you excluded.
- **The spec already says so.** Live evidence tells you what the product does, never whether that
  is wrong. Read the requirement before ranking the candidate.
- **The mechanism you blamed is not the one that runs.** Reading a function is not establishing
  which branch executes. A guard on the surface you looked at can be absent on the one that
  actually serves the screen.

Then:

- **Confirm scope or ownership from two independent places.** One field agreeing with your theory
  is not confirmation.
- **The strongest evidence is the product contradicting itself.** "Its own ownership-scoped query
  answers `{"data":[]}` for this caller, and three sibling routes serve the record anyway" cannot
  be argued down as a misreading of intent — the product already stated the intent.
- **Grade every claim: `[V]` verified live, `[I]` inferred from code.** Never let an inferred write
  become a claimed write. If you blocked the request to keep the data safe, you learned what the
  client *sends*, not what the server *accepts* — say exactly that, and read the route's own
  WHERE clause instead of executing it.

## Q2 — Can a user reach it? Climb the ladder and name the rung.

| Rung | How the user gets there | Reading |
| ---- | ----------------------- | ------- |
| 1 | Plain clicks through the product's own nav, filters and grids | They will meet it |
| 2 | A normal browser action — back, forward, reload, refocus, bookmark | They will meet it |
| 3 | A link the product itself emits — email, Recently Used, shortcut, export, deep link | They will meet it |
| 4 | A hand-edited URL | Only on purpose |
| 5 | A crafted request — console `fetch`, curl, devtools | Only on purpose |

This is the filing bar in `docs/qa-test-lens.md` made countable — that doc sets it per lens, this
ladder says which rung you are standing on. If they ever disagree, the doc wins.

**Prove the rung. Do not tell a story about it.** Both of these were plausible stories that the
product then refused:

- *"A user reaches the empty shell through an archived or deleted record."* Checked: no
  `Archived`, `Duplicate` or `Completed` record existed in 2,082 rows, and a `Rejected` one rendered
  normally. No lifecycle state yields zero rows — so the rung was 4, not 3, and the finding lost
  its ticket.
- *"Recently Used still surfaces the hidden shortcut."* Checked: it listed only the visible menus,
  even after that session had hit the hidden pages repeatedly and `saveRecents` had recorded them.
  Rung 4, not 3.

And one that the product confirmed, which moved a finding *up*:

- *"A fabricated confirmation only appears if you type the URL."* Checked with browser Back: the
  same screen re-rendered with a **new** timestamp, 10:54 → 10:55. Anyone who legitimately submits
  and then goes back meets it. Rung 2.

Rules:

- Reaching it with `force: true`, `evaluate`, `scrollTop` or a seeded row means the rung is
  **unproven**, not proven. Reach it the way the user does or say you could not.
- A rung is a claim about the product, so it needs the same evidence as any other claim. "Nothing
  in the product links here" is worth checking — count the links.
- Rungs 4 and 5 are not disqualifying. They cap the *default* weight; Q3 can lift it back.

## Q3 — What does it cost? Run the consequence test.

One question: **what does the user do differently because of this?** If the honest answer is
"nothing", it is cosmetic, and cosmetic is not a defect. A visual audit that skipped this went
0 for 5.

If there is an answer, name four things and nothing else:

- **Who** — the persona, not "the user". An admin, a buyer, a vendor.
- **What they see** — the wrong value, in the words on the screen.
- **What they wrongly conclude** — the belief the screen creates.
- **What that costs** — a wrong decision, a lost record, exposed data, a support ticket.

Impact does not inherit from the rung. The two multiply, and either one can carry a finding:

| | Harmless payload | Severe payload |
| --- | --- | --- |
| **Rung 1–3** | Low — file it, say it is minor | High — file it today |
| **Rung 4–5** | Drop or note it | **Still high.** Another tenant's pricing data behind a hand-edited URL is worth a ticket the day you find it |

## The verdict — exactly one per candidate

- **Ticket** — real, reachable or severe, and it needs a fix nobody has committed to.
- **PR comment** — the change under test claims something it did not deliver. A PR that says it
  mirrors a sibling's not-found handling, where the sibling's guard does not actually fire, is a
  comment while the author still has the context — not a ticket that rots in Backlog.
- **Report note** — valid, mechanism confirmed, nothing leads a user there. Write down *why* it is
  a note, so the next person does not re-litigate it.
- **Drop** — Q1 killed it. Record what killed it, in the place it was raised.

**Filing unreachable Lows is not free.** Three of them cost more credibility than they return, and
that credibility is what gets the severe one fixed the same day.

## Output

One block per candidate, in severity order. No preamble.

```markdown
### <F-n> — <one-line claim>
Real: [V]/[I] <what confirmed it> · killed: <the alternative that did not survive>
Rung: <1-5> — <what leads the user there, or what was checked and refused>
Cost: <who> sees <what> → concludes <what> → costs <what>
Verdict: ticket | PR comment | report note | drop — <why, one clause>
```

Then one line: what you would file today, and what you would not.

## Rules

- Adjudicate before counting. First-pass counts inflate roughly 10:1; give the number after the
  verdicts, not before.
- One candidate at a time. Finishing Q1–Q3 on a weak finding beats half-answering five.
- Never adjudicate a mutation you have not verified as reverted or never landed. Check the record
  and state it plainly, including the probe you fired before you understood the path.
- Retract in the same place you raised it, with the measurement that killed it — not an apology.
- Hand the survivors to `qa-bug` with their rung and cost already written. That is the one clause
  `qa-bug` wants in Description, and it is now derived instead of guessed.

## Hard-won rules (from past runs)

- First-pass finding counts inflate roughly 10:1. Confirm each one before naming a number.
- Git-check every mechanism claim. A lead argument once cited code that did not exist at that sha.
- Reproducible is not reachable. Grep every write path for the precondition before calling a finding high.
- Code and payload analysis is the hypothesis. The live verdict is the deliverable.
- A reconciliation mismatch is usually your own null/zero filter, not a product bug.
- Cosmetic is not a defect. Run the consequence test first — a visual audit once scored 0 of 5.
- Name the denominator. A real count or a silent grep can still be false evidence.
- Live evidence says what the product does, never whether it is wrong. A code comment does not outrank the requirement.
- Reach the repro with the product's own filters and plain clicks. force/evaluate/scrollTop means reachability is unproven.
- Suppressing a false failure can create a false pass. Check what status the row falls through to; the default is usually PASS.
- A 404 is a git question first. Check removed, unmerged or other-repo code before filing a missing page — 5 of 9 "bugs" were not bugs.
