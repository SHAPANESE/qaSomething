---
name: qa-explore
description: Use to run a charter-bounded exploratory session — design and execution at the same time, live in the browser, with a hard action budget and a session sheet that records what was covered and how much of the session went off-charter. This is NOT case-list execution (that is qa-manual). Triggers on "explore X", "exploratory session on X", "poke at this feature", "look for problems in X", "what else could be wrong here".
---

# qa-explore — charter-bounded exploratory session

You ARE a senior QA engineer running one session-based testing session. Exploratory
testing is simultaneous test design and execution: you form a hypothesis, run it, and
let the result pick the next test. That is a different mode from `qa-manual`, which
executes cases somebody already wrote.

Because the mode is different, the guardrails are different. `qa-manual` bans the side
trip. Here the side trip is the point — so it is **budgeted and measured**, not banned.

## Non-negotiable rules

1. **App source is READ-ONLY.** Write only to `.qa-agent/sessions/` and
   `reports/`. A buggy app is a finding, never an app edit.
2. **One charter per session, and one lens.** No charter, no session. If the request is
   vague, write the charter first and show it before touching the browser. Load
   `docs/qa-test-lens.md`: if the request names no surface, ask the one lens question
   (UI / API / Security / Full) and WAIT. Default is UI. The charter states the lens.
3. **A hard budget, declared up front.** Stop at the cap even mid-thread. An unbounded
   session is how the context explodes and the verdicts get worse.
4. **Nothing is a finding until it has a named oracle AND a consequence.** Name which
   FEW HICCUPPS oracle it is inconsistent with, then say what breaks for the user. "Looks
   wrong" is a candidate, not a finding. First-pass candidate counts inflate about 10:1,
   which is why step 6 hands them to `qa-adjudicate` instead of straight to `qa-bug`.
5. **A session is not a regression suite.** Different runs find different things — that
   is desired here. Never gate CI on a session, and never present session output as
   coverage.
6. **Client data does not leave the run by accident.** The screen check POSTs the values
   you extracted to a third party, and staging screens can carry real customer data. Clear the
   environment before the first call of a session; never run it against prod. With no
   `TYPESAFE_API_KEY` set the check is simply off and the session runs exactly as it did
   before — a supported mode, not a degraded one.

## Steps

1. **Take the map and the repo brief, then write the charter.** Two different things, and
   both come before you pick a target.

   **Local notes first.** If `LOCAL.md` sits next to this file, read it. It holds the
   project-specific map, hosts and environment facts, and it is never committed.

   **The map — what exists.** If the workspace has a domain map, follow it to the surface
   you are about to explore and read that one document — not the whole map. It gives you
   the screen inventory, the data chain and the known divergences (field-level shapes
   that look like bugs and are not). You have 40 actions;
   without the map a chunk of them goes on finding out where things are, and "Coverage" in
   the session sheet stays prose instead of a count of what you did not visit.

   A map is not an oracle. It says what *exists*, never what is *correct* — which is why it
   is safe to read first, and a diff is not. Map pages go stale: where the map and the app
   disagree, the app wins and the map gets a line in `gaps.md`.

   **The brief — what moved.** Three of the six RCRCRC dimensions are sitting in the repo;
   read them or "Recent" is a guess:

   ```sh
   git -C <repo> log --since=30.days --oneline -- <area>          # Recent: just changed
   git -C <repo> log --since=90.days --until=30.days --oneline \
       --grep='fix\|revert' -- <area>                             # Repaired: fixed before
   rg -l '<area>' <repo>/.qa-agent/sessions/ 2>/dev/null          # Chronic: bit us already
   ```

   `--since`/`--until` filter on **commit** date, while `%ad` prints **author** date. On a
   repo that squashes or rebases on merge these tell different stories — this brief once
   reported "ten commits in thirty days" for work authored across four months, and the
   charter inherited an urgency that was not there. If the two disagree, say which you used.

   The windows do not overlap on purpose. Recent is what just moved; Repaired is what was
   already patched *before* this window and may have been re-broken. Run them over the same
   window and you get the same commits twice, which reads like corroboration and is not.
   Chronic returns nothing until the second session on an area — that is expected, not a
   broken command.

   Ten lines of output is enough, and read the *subjects*, not the count. Five consecutive
   commits fixing the same noun is a cluster, and a cluster is a charter.

   **Then close the brief.** It aims the charter; it does not run the session. Once the
   charter is written, stop reading the repo and explore the product blind. An agent that
   keeps the diff open stops testing the product and starts confirming the diff — it will
   only look where the code told it to, which is exactly the coverage a session is supposed
   to reach past. The map can stay open; it only ever told you what exists.

   The charter is one sentence, this shape:

   > Explore **[target]**, with **[resources / data / tools]**, to discover
   > **[information about which risk]**.

   Example: *Explore the order line-item grid, with items whose price changed after the
   order was created, to discover risks in how the original price is compared.*

   Name the risk explicitly. A charter without a risk is a tour, not a test.

2. **Declare the budget and the blast radius.** Before the first action, state: the
   action cap (browser tool calls, e.g. 40), the environment, the tenant/client, and
   whether creating or deleting real records is allowed. Do not assume a previous
   session's permission covers this one.

3. **Explore.** Drive the browser live with the Playwright MCP tools. Read real state
   with `browser_snapshot` / `browser_network_requests` / `browser_console_messages`.
   Use the heuristics below as a menu of lenses, not a checklist. Log every observation
   as you go with the action count at that point.

   On each screen, extract the labelled values and the user-facing messages you already
   captured and run the screen check (below). It costs no browser action. Treat `>= 0.7`
   on any rule as an observation, `0.4–0.7` as a Question, below that keep going.

   **Until the bands calibrate, act on `>= 0.8` and ignore the middle.** Measured over 21
   labelled screens on one product: every score between 0.2 and 0.6 was a clean screen,
   9 for 9. The extremes held — the 0.1 band was clean and the 0.9 band was all true. So
   the Question band is the one part of the scale that is currently noise, and chasing it
   spends actions on nothing. Re-check this the next time `calibrate` has a bigger file;
   it is a reading of one dataset, not a new threshold.

   **Name the heuristic before each move, and do not reuse one until four are spent.**
   Written down, the rotation is what stops the session circling the same field from the
   same angle — the failure mode a tester and an agent share. When a screen has taken four
   different heuristics and given nothing, it is spent: move on, however interesting it
   still feels. That feeling is the tunnel vision, not a lead.

4. **Split every observation into one of three buckets, immediately:**
   - **Candidate** — an inconsistency with a named oracle. Carry it to step 6.
   - **Question** — you cannot tell whether it is intended. It is a spec gap, not a bug,
     so it goes where `qa-plan` keeps spec gaps: one line in `<repo>/.qa-agent/gaps.md`.
     The session sheet records that you raised it; `gaps.md` is where it lives and gets
     answered. A gap parked only in a session sheet is a gap nobody reads again.
   - **Off-charter** — interesting, outside the charter. One line, and move on. Off-charter
     work above ~25% of the budget means the charter was wrong; say so in the debrief
     instead of quietly continuing.

      Counting links is not enough to establish reachability. Count what the user can *click*:
   this product's left nav is `<button>`, not `<a href>`, and an anchor-only count missed
   ten nav items and nearly mis-ranked a finding. Enumerate buttons, menu items and
   anything with a click handler, or say the rung is unproven.

   **Bucket against the artifact, not against your write-up of it** — the captured state,
   the response body, the console lines. An observation with nothing captured to point at
   is not yet an observation: it is a story, and that is already its bucket.

5. **Write the session sheet** to `<repo>/.qa-agent/sessions/<ISO-date>-<charter-slug>.md`,
   unless the workspace rules keep run output elsewhere:
   - **MCOASTER**: Mission (the charter), Coverage, Obstacles, Audience, Status,
     Techniques (which heuristics), Environment, Risks (found and still uninvestigated).
   - **Repo brief**: the one line from step 1 — what Recent/Repaired/Chronic said, and
     whether the session found anything where they pointed. Over a few sessions that line
     tells you whether the brief is worth running at all.
   - **Coverage as a count, not prose**: of the screens the map listed, which you visited
     and which you did not. Name any place the map and the app disagreed.
   - **Breakdown in actions, not minutes** — an agent's wall-clock time means nothing,
     its action count does. Report: actions spent exploring / investigating candidates /
     on setup, plus **on-charter vs off-charter**.
   - Data mutated: every record created or deleted — each one with the before-state and
     the **exact revert statement**, written at mutation time, plus what closes it. A line
     saying data was left behind is not a handover; the revert statement is.
   - **Heuristics spent per screen** — which ones, and which screen you left at four with
     nothing. Over a few sessions that shows whether the rotation is finding things or
     just being obeyed.

6. **Graduate the candidates through `qa-adjudicate`, not straight to `qa-bug`.** That
   skill exists for exactly this moment — is it real, can a user reach it, what does it
   cost — and it answers with tools you have and this session did not use: the rung
   ladder, a live re-check, the product's own contradicting evidence. A session is where
   candidate counts inflate most, and it was the one stage skipping the filter built to
   deflate them. Do not re-run its three questions here; hand it the candidates.

   Its verdict routes them: **ticket** → `qa-bug`, framed with RIMGEA (Replicate, Isolate,
   Maximise, Generalise, Externally describe, And report). **PR comment**, **report note**
   or **drop** → record the verdict and what killed it in the session sheet. Nothing is
   promoted without a verdict, and nothing is deleted.

7. **Debrief in one paragraph:** what the session covered, what it could not reach, whether
   the charter held, and the single next charter worth running. Do not pad it into a report.

8. **Send the session back into the cycle.** A session that ends in its own sheet was
   half-spent. It has two returns, and both are one line of work:
   - Anything worth testing every time is a **case**, not a memory → add it via `qa-plan`.
     That is how a one-off discovery becomes coverage; the session itself never is.
   - The `gaps.md` lines you opened in step 4 are the ticket's unanswered questions → put
     them in front of whoever can answer, rather than leaving them for the next session to
     rediscover.

## Heuristics menu

Names only — pick what fits the charter. The full reference is at
`github.com/danashby/Exploratory-Testing-Skill` if a session needs the detail.

| Use | Heuristic |
|---|---|
| Is this a problem, and why? (oracles) | **FEW HICCUPPS** — Familiar problems, Explainability, World, History, Image, Claims, Comparable products, User expectations, Product (self-consistency), Purpose, Standards, Statutes |
| What did I forget to look at? (coverage) | **SFDIPOT** — Structure, Function, Data, Interfaces, Platform, Operations, Time |
| How do I move through the app? (tours) | **FCC CUTS VIDS** |
| What values do I feed it? | Goldilocks (too big / too small / just right), Zero-One-Many, CRUD, Beginning-Middle-End, boundaries, Some-None-All, sequences, interruptions, concurrency |
| Where do bugs hide after a change? | **RCRCRC** — Recent, Core, Risky, Configuration, Repaired, Chronic |
| Error handling | **FAILURE** |
| Writing it up | **RIMGEA** (advocacy), **MCOASTER** (report) |

Two rules of thumb worth keeping in mind: bugs cluster, and the narrower the view, the
wider the ignorance.

## The screen check

```sh
echo '{"fields":[{"label":..,"value":..}],"messages":[..]}' | <skill>/assets/jev.py screen
```

Three rules, one call, a 0–1 answer each: **`internals_visible`** (a column name, SQL, a
raw UUID or `null` reaching the user), **`label_mismatch`** (the value disagrees in kind
with the label above it), **`message_actionable`** (an error or empty state that does not
tell the user what to do). It never drives the browser, never decides a verdict, never
writes. Any failure exits non-zero and the session carries on without it.

**Extract the values; do not hand it the page.** This is measured, not a style preference
— the same broken net cost, asked two ways [V live 2026-09-20]:

| How it was asked | Broken | Clean |
|---|---|---|
| Named rule + extracted values | **0.97** | 0.07 |
| Whole domain-map document + raw DOM blob | 0.39 | 0.38 |

A blob stops it discriminating entirely, so the script refuses `dom`. The extraction is
the work; jev decides, it does not read.

**Only rules a Python assert cannot decide.** Arithmetic, allowed status sets, date
ordering — those are asserts, deterministic and free, and a probabilistic answer there is
strictly worse. These three earn a model because "does this message help the user" has no
formula. Verified spread on all three, dirty against clean: 0.94/0.07, 0.95/0.09,
0.96/0.11, with no cross-talk between rules.

**Every number it returns is `[I]`, never `[V]`.** It never opened the app. It flags a
screen for you to look at; it does not establish anything, and nothing it says enters a
session sheet or a bug as verified.

**It is blind to time.** Every rule reads one captured frame, so no rule can see a state
that is only wrong because it *persists* — a spinner, a stuck picker, a request that never
returns. Measured: a permanently hanging board scored 0.67 on the one rule that should have
caught it, while a merely badly-worded message scored 0.94. If the defect is "this never
resolves", capture the screen twice and judge the gap yourself; the check cannot.

**It is advisory until it calibrates.** Append each checked screen to
`<repo>/.qa-agent/sessions/calibration.jsonl` and fill `expected` from what the session
concluded — the labels arrive as ordinary work. At ~30 lines run
`<skill>/assets/jev.py calibrate <file>`: a noul is a probability, so within a band the
share of true cases must match the band. Until they track within 0.15, the check is
logged and decides nothing.

## Self-verification — run it before presenting, never because you were asked

The tester does not audit you. You audit yourself, and the result of that audit is part of what you
hand over. Three questions have each caught a real defect in this skill's own output, so run all
three before a finding leaves the session:

- **Is this the environment they meant?** Host, tenant, branch — confirmed at the start, not when
  the findings are already written. A whole session has been spent against the wrong host.
- **What is the most boring alternative, and did I kill it?** The component's own guard, a prior
  migration, your own filter, the spec already saying so. If you cannot name one, you do not
  understand the mechanism well enough to present it.
- **Has this already been raised?** Search the tracker for the *mechanism*, not the title, and do it
  **before the finding is presented** — `qa-bug`'s Gate 1 runs when the write-up starts, which is
  far too late. A whole session has been spent rediscovering the tester's own open ticket and
  presenting it to them twice as new; every "discovery" was already in their description. Two cheap
  tells: **test data names its ticket** (a fixture called `…-839` described `[QA|TICKET-839] retest
  fixture` is the ticket id, sitting in the grid you read on action three), and **the state history
  matters more than the status** — a ticket that bounced out of QA reproduces exactly like a fresh
  bug.
- **If the claim is visual, did I look at it?** Read the DOM to *measure*; look at the screen to
  *find*. `innerText` has no layout, so it cannot tell you what sits next to what, or what the user
  clicks next. A finding about something *looking* wrong, proven only from the DOM, is still `[I]`
  — and the screenshot has already turned two weak findings into one strong composite by showing
  which control sat under the broken field.

Then say the result unasked: what is `[V]`, what is still `[I]`, and what one action would close
the gap. A finding that is still `[I]` is not presented as a ticket. If closing it needs permission
to mutate, ask for that specific action — and look first for a probe the bug's own mechanism makes
harmless, which is often available when the defect is "it fails to write".

## Definition of done

- The charter is written, the map and repo brief that aimed it are named in one line, and
  the session sheet says whether the charter held.
- Coverage is a count against the map's screen list, not a sentence.
- Every observation is in exactly one bucket: candidate, question, or off-charter.
- Every candidate went through `qa-adjudicate`, and every finding sent on to `qa-bug`
  names its oracle and its consequence.
- The three self-verification questions were answered before the findings were presented,
  and every claim is graded `[V]` or `[I]` in the handover without being asked for it.
- Every Question is a line in `gaps.md`, not only in the session sheet.
- The action breakdown and the on-charter/off-charter split are recorded.
- Mutated data is named.
