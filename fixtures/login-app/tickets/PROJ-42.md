# PROJ-42: Sign-in form — validation and feedback

The sign-in form must authenticate valid users and give clear, specific feedback
on failure.

## Acceptance criteria

- **AC1** — Given valid credentials (`user@test.com` / `secret123`), when the user
  signs in, the page shows `Welcome, user@test.com`.
- **AC2** — Given a correct email but a wrong password, the page shows
  `Invalid credentials`.
- **AC3** — Given an **empty email**, when the user submits, the page shows
  `Email is required` and does NOT attempt to authenticate (no request to the
  login API).

## Notes

Feedback is shown in the status line below the form. Error messages must be
specific — a generic "Invalid credentials" is not acceptable when the real
problem is a missing field.
