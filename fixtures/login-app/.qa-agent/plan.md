# QA Plan — PROJ-42 (Sign-in form — validation and feedback)

Oracle: `tickets/PROJ-42.md` (AC1–AC3). App: a single sign-in form
(`public/index.html`) posting to `POST /api/login` (`server.mjs`).

## Phase 1 — Prioritize by risk

Risk = Impact × Probability. Authentication is the highest-impact surface in
this app (it is the _only_ feature), so the ranking below is driven mostly by
probability of a bug and how badly a miss would hurt the user.

| # | Item | Impact | Probability | Risk | Verdict |
|---|------|--------|-------------|------|---------|
| 1 | AC3 — empty email must short-circuit with `Email is required`, no API call | High (misleads the user, calls the API needlessly) | High (ticket explicitly calls this out; recent/likely area of a slip) | **Highest** | Test — negative |
| 2 | AC1 — valid credentials sign in and show the exact welcome text | High (core function; a false negative here blocks every legitimate user) | Low-medium (straightforward path, but the message text is exact-match, easy to typo) | High | Test — happy |
| 3 | AC2 — wrong password shows the exact, specific `Invalid credentials` message | Medium-high (wrong/leaky messaging is a security & UX smell) | Medium (adjacent to the AC3 bug — same code path decides pass/fail) | High | Test — negative |
| 4 | Boundary: whitespace-only email (` `) | Medium (spec doesn't say if this counts as "empty") | Medium (client does not trim; likely falls through like AC3's bug) | Medium | Test — boundary (also a gap, see gaps.md) |
| 5 | Boundary: empty password with a valid email | Medium (analogous failure mode to AC3, but for the other field) | Medium (ticket never mentions the password field at all) | Medium | Test — boundary |
| 6 | Security: script/markup injection in the email field (`<script>alert(1)</script>`) | Medium-high if unescaped (stored/reflected XSS in a status line) | Low (status line is set via `textContent`, not `innerHTML`, so injection is unlikely to execute — still worth a spot-check on an auth form) | Medium | Discard — no echo/render surface exists today to observe (see gaps.md) |

### Explicitly discarded (and why)

- **Double-submit / rapid re-click (concurrency/idempotency).** The login
  endpoint is a stateless credential check with no side effects to duplicate
  (no session write, no email, no charge) — a double click at worst fires the
  fetch twice with identical results. Low impact for this fixture; discarded.
- **Two parallel tabs / session races (concurrency).** There is no session or
  shared server-side state in this app (no cookies, no persisted login state)
  — nothing to race. Discarded.
- **Network drop / slow backend / 500 mid-flow (interruption).** The fixture
  server has no simulated latency or failure mode, and the ticket does not ask
  for a resilience story here. Discarded for this pass; would revisit if the
  app grows a real backend.
- **Accessibility deep-dive (a11y).** The status line already uses
  `role="status"` + `aria-live="polite"` and the form uses native
  `<label for>` associations — correct by inspection, not a recent change, and
  not called out by the ticket. Not worth a dedicated case this pass; flagged
  as low-risk rather than gold-plated.
- **Performance, compatibility, i18n.** Single-locale static page, no
  perf/browser-matrix requirement in the ticket, no dataset to paginate or
  throttle. Discarded as out of scope for PROJ-42.
- **Case-sensitivity of the email comparison (data-integrity).** Real risk
  exists (`user@test.com` vs `User@Test.com`), but the ticket does not define
  the expected behavior either way — recorded as a spec gap (gaps.md) rather
  than assumed and tested either direction.
- **Rate limiting / lockout after repeated failures (security).** Not
  mentioned anywhere in the ticket or visible in the server code path;
  inventing a policy and testing it would be testing our own assumption, not
  the spec. Recorded as a gap instead.
- **Script/markup injection in the email field (security).** The server always
  returns the static string `Invalid credentials` and the client renders it via
  `textContent` — there is no echo/render surface today for a submitted email
  to reach, so there is nothing observable to assert against. Not testable
  against a defined oracle; recorded as a future-hardening gap instead (see
  gaps.md).

## Phase 2 — Discovery pass (scenario categories per prioritized item)

| Item | happy | negative | boundary | state | concurrency | security | a11y | gap? |
|------|-------|----------|----------|-------|-------------|----------|------|------|
| AC1 valid login | **covered** (TC-01) | – | – | – | – | – | – | – |
| AC3 empty email | – | **covered** (TC-03) | – | – | discarded (no shared state) | – | – | – |
| AC2 wrong password | – | **covered** (TC-02) | – | – | – | discarded (generic message is intentional, matches AC) | – | – |
| whitespace-only email | – | – | **covered** (TC-04) | – | – | – | – | **gap** (is whitespace "empty"?) |
| empty password | – | – | **covered** (TC-05) | – | – | – | – | **gap** (no AC for password) |
| injection in email field | – | – | – | – | – | discarded (no echo surface to test) | – | **gap** |
| email case-sensitivity | – | – | – | – | – | – | – | **gap** |
| repeated failed attempts | – | – | – | – | – | discarded (no lockout spec) | – | **gap** |

## Result

5 cases written to `cases.md`: 1 happy, 2 negative, 2 boundary.
5 items explicitly discarded with reasons above, including the email-field
injection spot-check (no echo/render surface exists today to test against).
5 spec gaps recorded in `gaps.md`, including the whitespace/empty-email
ambiguity called out for this task and the future-hardening note on
unescaped email echo.
