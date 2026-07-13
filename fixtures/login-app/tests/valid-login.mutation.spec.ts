// case: TC-PROJ-42-01
import { test, expect } from "@playwright/test";

// Mutation proof for AC1. We break the login API via network interception
// (no app-source edit). The welcome assertion MUST fail — proving the real
// test verifies behavior, not just that the page rendered.
test("AC1 [mutation]: welcome must not appear when the login API is broken", async ({ page }) => {
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "boom" }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Email").fill("user@test.com");
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toHaveText("Welcome, user@test.com");
});
