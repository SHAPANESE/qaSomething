import { test, expect } from "@playwright/test";

// Mutation proof for the hollow smoke test. We break the login API — yet this
// test STILL passes, because it never asserts on login behavior. That passing
// mutation is exactly what tells the gate the smoke test is not meaningful.
test("smoke [mutation]: still passes with the API broken (that is the problem)", async ({ page }) => {
  await page.route("**/api/login", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.goto("/");
  await expect(page).toHaveTitle("Sign in");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
