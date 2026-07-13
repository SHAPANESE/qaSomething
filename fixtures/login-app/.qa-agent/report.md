# QA sign-off — PROJ-42

_Generated 2026-07-13._

## Coverage

3/5 cases covered by trusted tests (**60%**). planned 1 · authored 0 · passing 3 · failing 0 · flaky 0 · bug 1.

## Covered by trusted tests

- `TC-PROJ-42-01` (happy) — AC1 — valid credentials sign in
- `TC-PROJ-42-02` (negative) — AC2 — wrong password shows a specific message
- `TC-PROJ-42-04` (boundary) — AC3 — whitespace-only email (spec gap, see gaps.md)

## Bugs found

- `TC-PROJ-42-03` (negative) — AC3 — empty email is rejected without hitting the API

Findings: `PROJ-42-bug-1.md`

## NOT covered (and why to look)

- `TC-PROJ-42-05` (boundary) — spec gap — empty password with a valid email

## Spec gaps

# Spec gaps — PROJ-42

One line per ambiguity/undefined edge case found while planning. None of these
are silently assumed — each is a finding, not a test.

- **Whitespace-only email.** AC3 defines "empty email" but not whether an
  email made only of spaces (`" "`) counts as empty. The client does not trim
  input before sending it, so today it is treated as non-empty and falls
  through to the generic `Invalid credentials` path (see TC-PROJ-42-04). The
  ticket should state whether whitespace-only counts as "empty".
- **Empty password.** The ticket only defines behavior for an empty *email*
  (AC3). There is no acceptance criterion for an empty password — should it
  get its own specific message (`Password is required`), or is falling
  through to `Invalid credentials` acceptable? Undefined (see TC-PROJ-42-05).
- **Email case-sensitivity.** The server compares email with strict equality
  (`email === USER.email`). Whether sign-in should be case-insensitive
  (`User@Test.com` vs `user@test.com`) is not specified anywhere in the
  ticket.
- **Rate limiting / lockout.** The ticket does not say whether repeated failed
  login attempts should be throttled or locked out. No such behavior exists in
  the current server; not testable against a defined oracle until the ticket
  (or a follow-up) states an expected policy.
- **Script/HTML injection in the email field.** The spec/app defines no
  behavior for markup in the email field, and there is currently no echo/render
  surface to test against — the server always returns the static string
  "Invalid credentials" and the client sets it via `textContent`. Flagged as a
  future-hardening gap: if an error message ever echoes the submitted email,
  it must be escaped, not injected as HTML.
