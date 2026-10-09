# The test lens — ask before you test

Every QA entry point (`qa`, `qa-plan`, `qa-manual`, `qa-explore`) asks ONE question
before it plans or executes anything: **what kind of test does the user want?**

The answer is the *lens*. It decides which scenario categories get depth, which
surface produces the evidence, and what a finding has to prove to be filable.

## The question

Ask it with `AskUserQuestion`, one question, four options, UI first:

- header: `Test type`
- question: `What kind of test do you want on this feature?`
- options:
  1. **UI — as the user (Recommended)** — drive the real screens; a bug must be
     reachable with the product's own controls.
  2. **API / contract** — endpoints, payloads, status codes, schema conformance.
  3. **Security / authorization** — roles, tenancy, privilege boundaries, exposure.
  4. **Full sweep** — all three, UI first, then API, then security.

## When NOT to ask

Do not ask when the user already named the lens in their request. Treat these as
answered and say which lens you took:

- "test the endpoint / the payload / the response" → API
- "can another role see X", "check the permissions/roles" → Security
- "test this screen / walk the flow / as a user" → UI
- "test everything", "full pass" → Full sweep

If the request is a plain "QA this ticket" with no surface named, ASK. Then stop
and wait — no planning, no browser, no code until the answer arrives.

## Default

**UI.** If the user does not answer, or answers something ambiguous, take UI and
say so in one line. Most users live in the screens; a defect that only exists
in a payload is not a defect they can hit.

## What each lens means

| Lens | Categories that get depth (qa-plan PHASE 2) | Evidence surface | Filing bar |
|---|---|---|---|
| UI | happy, negative, boundary, state, interruption, a11y, i18n | Browser screenshot of the real screen | Reproducible with plain clicks and the product's own filters. `force`, `evaluate`, injected responses, direct `scrollTop` = reachability NOT proven |
| API | contract, negative, boundary, idempotency, data-integrity, concurrency | Request/response pair, status code, schema diff | The contract (ticket AC / OpenAPI) is the oracle. No spec for the endpoint = a gap, record it |
| Security | security, state, data-integrity, contract — lead with **IDOR**: can user A read or write user B's record by id? then privilege escalation, then exposure | Two-persona run: the blocked call AND a 403/404 control | Never file on an injected response or an invalid body. Pair every block with a positive control that proves the control is alive |
| Full sweep | all of the above | All three | Run UI first — it changes what is worth probing at the other two layers |

## The UI-first rule (applies to every lens)

Even under the API and Security lenses:

1. Ask first whether the finding is reachable from the UI. If it is, reproduce it
   there and lead the report with that.
2. API and DB are for **setup, evidence and diagnosis** — not for the repro steps
   a developer will follow.
3. An API-only or DB-only finding is filable, but it must say so explicitly and
   name what stops a user from reaching it.

## Recording the answer

- `state.json` — add `"lens": "ui" | "api" | "security" | "full"` to the ticket entry.
- `plan.md` — first line after the title: `Lens: <lens> — <one line on what that
  excludes>`.
- The sign-off in `qa-report` states the lens and lists what the other lenses would
  have covered, as uncovered scope.

A lens is a priority order, not a blindfold. If a UI run trips over an obvious
authorization hole, record it — say it was out of lens, and offer the security pass.
