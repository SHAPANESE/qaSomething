# PROJ-42-bug-1 — Empty email is not validated (violates AC3)

**Case:** TC-PROJ-42-03 · **AC:** AC3 — empty email is rejected without hitting the API

**Severity:** Medium · **Priority:** High (clear user-facing validation gap on a
critical flow — sign-in)

## Repro

1. Open the sign-in page (`GET /`).
2. Leave the Email field empty; enter any password (or none).
3. Click "Log in".

Data: `email=""`, `password=""` (or any non-empty password — the email field alone
is the trigger).

## Expected vs actual

**Expected (ticket PROJ-42, AC3):** "Given an **empty email**, when the user
submits, the page shows `Email is required` and does NOT attempt to authenticate
(no request to the login API)."

**Actual:** the page shows `Invalid credentials`, and the app DOES call the login
API (`POST /api/login`).

## Evidence

Client (`fixtures/login-app/public/index.html`) has no empty-email guard before
the `fetch` call — the submit handler goes straight from reading the form fields to
`fetch("/api/login", ...)`, annotated in the source itself:

```
// PLANTED BUG (ticket AC3): no empty-email validation here either.
const res = await fetch("/api/login", { ... });
```

Server (`fixtures/login-app/server.mjs`) has no server-side empty-email check
either — an empty email simply fails the credential match and falls into the
generic 401 branch, also annotated in the source:

```
// PLANTED BUG (ticket AC3): an empty email must return "Email is required".
// Instead it falls through to the generic invalid-credentials path.
if (email === USER.email && password === USER.password) {
  ...
} else {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Invalid credentials" }));
}
```

Observed exploratory probe (`fixtures/login-app/reports/PROJ-42-findings.md`,
BUG-1):

```
message shown:    "Invalid credentials"
expected (AC3):   "Email is required"
login API called: true  [ 'POST http://localhost:3100/api/login' ]
```

## Two distinct violations

1. Wrong message — generic "Invalid credentials" instead of the ticket-specified
   "Email is required".
2. Unnecessary auth attempt — an empty-email submit should be rejected client-side
   before hitting the login API; instead `POST /api/login` is called every time.

## Severity vs priority

**Severity: Medium** — the form doesn't crash and a determined user can still see
*some* error text; sign-in with valid creds is unaffected.

**Priority: High** — this is a named, explicit acceptance criterion (AC3) on a
critical flow (sign-in), and the wrong message actively misleads users into
thinking their credentials are wrong when the real problem is a missing field.

## Not committed as a test

Since the app violates the ticket, this is reported as a finding rather than
committed as a passing test (a passing test here would freeze the bug as
"correct"). Once fixed, the trusted test for AC3 (`TC-PROJ-42-03`) is a two-line
addition.
