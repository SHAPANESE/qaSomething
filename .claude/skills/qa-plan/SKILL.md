---
name: qa-plan
description: Use to turn a ticket / acceptance criteria into a risk-ranked, criterio-audited QA plan BEFORE writing any test — enumerates cases across scenario categories (negatives, boundaries, state, concurrency, security…), flags spec gaps as findings, and writes them to the .qa-agent casebook. Triggers on "plan QA for", "what should we test", "design test cases for", "analyze this ticket".
---

# qa-plan — design the tests before writing them

You ARE a senior QA engineer doing the _thinking_ stage. Output is reviewable
artifacts in the `.qa-agent/` casebook, not code. Do NOT write Playwright tests
here — that is `qa-author`.

## Inputs to establish first

- **Repo under test** (`--repo <path>`), and the **ticket = the oracle** (file or
  Jira via the Atlassian MCP). No ticket → say so and ask; without a source of
  truth you would freeze current bugs as "correct".

## Non-negotiable process (from docs/qa-senior-criteria.md — load it and follow it)

1. **PHASE 1 — Prioritize by risk (always first).** Risk = Impact × Probability.
   Produce an ordered list of what is worth testing and **explicitly discard**
   the low-value items with a reason. If you discarded nothing, you did not
   prioritize.
2. **PHASE 2 — Discovery pass per prioritized item.** For each item, walk the
   scenario categories and decide, per category, one of: **covered** (write a
   case), **discarded** (say why), or **gap** (the ticket does not define it →
   record it in gaps.md). Categories: happy, negative, boundary, state,
   concurrency, idempotency, data-integrity, interruption, security, a11y,
   performance, compatibility, i18n. **Happy path is the floor, not the goal.**
3. **Question the spec.** Ambiguity, undefined edge case, contradiction, or an
   unstated assumption is a FINDING → gaps.md, before any test exists.
4. **Optional exploratory pass** to surface what the ticket does not say: use the
   `explore` module / tours / "follow the data" / CRUD-per-entity.

## Writing the casebook

Write these files under `<repo>/.qa-agent/` (create the dir if missing):

- **plan.md** — the risk ranking: what to test, what was discarded and why.
- **cases.md** — one block per case, in this exact format (parsed by the
  casebook module, so match it):

```

---

id: TC-<TICKET>-NN
ac: "<which acceptance criterion>"
priority: high|medium|low
category: happy|negative|boundary|state|concurrency|idempotency|data-integrity|interruption|security|a11y|performance|compatibility|i18n
status: planned
---

  <one or two sentences: the scenario and its expected result>
```

Number cases sequentially per ticket (TC-<TICKET>-01, -02, …). Each prioritized
item should have MORE than a happy case where risk warrants it — a
prioritized item with only a happy case must be justified in plan.md.

- **gaps.md** — one line per spec gap/ambiguity/contradiction found.
- **state.json** — set this ticket's phase to `planned`. If unsure of the exact
  JSON, run:
  `node <qa-agent>/dist/index.js` is NOT needed — write state.json as
  `{ "version": 1, "tickets": { "<TICKET>": { "ticketId": "<TICKET>", "phase": "planned", "updated": "<ISO8601>" } } }`.

## Definition of done

- plan.md shows an explicit risk ranking WITH discards.
- cases.md covers non-happy categories (negatives/boundaries at minimum) for the
  high-risk items, each tagged with its category — the coverage is auditable.
- gaps.md lists what the ticket leaves undefined.
- You stated what you did NOT plan to test and why.
