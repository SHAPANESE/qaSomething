# PROJ-42 — QA findings

Tested against ticket PROJ-42 acceptance criteria. Verified tests live in
`tests/` (each with a `*.mutation.spec.ts` proof). One acceptance criterion is
violated by the app.

## Summary

| AC | Behavior | Result |
|----|----------|--------|
| AC1 | Valid credentials → "Welcome, user@test.com" | ✅ Pass (trusted test) |
| AC2 | Wrong password → "Invalid credentials" | ✅ Pass (trusted test) |
| AC3 | Empty email → "Email is required", no auth attempt | ❌ **BUG** |

## BUG-1 — Empty email is not validated (violates AC3)

**Severity:** Medium · **Priority:** High (clear user-facing validation gap on a
critical flow)

**Expected (AC3):** submitting with an empty email shows `Email is required` and
does NOT call the login API.

**Actual:** the app shows `Invalid credentials` and DOES call the login API.

**Steps to reproduce:**
1. Open the sign-in page.
2. Leave Email empty; enter any password.
3. Click "Sign in".

**Evidence (exploratory probe):**
```
message shown:    "Invalid credentials"
expected (AC3):   "Email is required"
login API called: true  [ 'POST http://localhost:3100/api/login' ]
```

**Two distinct violations:**
1. Wrong message — generic "Invalid credentials" instead of the specific
   "Email is required". The ticket explicitly calls this out as unacceptable.
2. Unnecessary auth attempt — an empty-email submit should be rejected client-side
   before hitting the login API.

**Not committed as a test:** since the app violates the ticket, this is reported
as a finding rather than committed as a passing test. Once fixed, the trusted
test for AC3 is a two-line addition.
