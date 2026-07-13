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
