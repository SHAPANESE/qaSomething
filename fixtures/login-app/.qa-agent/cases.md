---
id: TC-PROJ-42-01
ac: "AC1 — valid credentials sign in"
priority: high
category: happy
status: passing
spec: tests/valid-login.spec.ts
---
Given valid credentials (user@test.com / secret123), when the user submits the sign-in form, the page shows exactly "Welcome, user@test.com".

---
id: TC-PROJ-42-02
ac: "AC2 — wrong password shows a specific message"
priority: high
category: negative
status: passing
spec: tests/wrong-password.spec.ts
---
Given the correct email but an incorrect password, when the user submits, the page shows exactly "Invalid credentials" and no welcome text appears.

---
id: TC-PROJ-42-03
ac: "AC3 — empty email is rejected without hitting the API"
priority: high
category: negative
status: bug
---
Given an empty email field (any or no password), when the user submits, the page shows "Email is required" and no request is made to POST /api/login. Known planted bug: the app currently shows "Invalid credentials" and does call the API.

---
id: TC-PROJ-42-04
ac: "AC3 — whitespace-only email (spec gap, see gaps.md)"
priority: medium
category: boundary
status: passing
spec: tests/whitespace-email.spec.ts
---
Given an email consisting only of spaces (" "), when the user submits, the observed behavior is documented as-is: the field is not trimmed client-side, so the app treats it as a non-empty value and falls through to the generic "Invalid credentials" path rather than "Email is required".

---
id: TC-PROJ-42-05
ac: "spec gap — empty password with a valid email"
priority: medium
category: boundary
status: planned
---
Given a valid email and an empty password field, when the user submits, the app shows "Invalid credentials" (the only defined error path) since the ticket defines no dedicated empty-password message.
