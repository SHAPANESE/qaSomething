import { test, expect } from "@playwright/test";

// DELIBERATELY HOLLOW: this only checks the page rendered, not any behavior.
// It should pass — but the trust gate must REJECT it, because its mutation
// proof (below) also passes: breaking the login API changes nothing it asserts.
test("smoke: the sign-in page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Sign in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
