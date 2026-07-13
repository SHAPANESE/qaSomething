// case: TC-PROJ-42-04
import { test, expect } from "@playwright/test";

// Mutation proof for the whitespace-email boundary case. We break the login
// API via network interception (no app-source edit) so it wrongly ACCEPTS a
// whitespace-only email. The "Invalid credentials" assertion MUST then fail —
// proving the real test verifies the rejection behavior, not just any status
// text.
test("boundary [mutation]: assertion must fail if the API wrongly accepts a whitespace email", async ({
  page,
}) => {
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, name: " " }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Email").fill(" ");
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toHaveText("Invalid credentials");
});
