// case: TC-PROJ-42-02
import { test, expect } from "@playwright/test";

// Mutation proof for AC2. We make the API wrongly ACCEPT the login. The
// "Invalid credentials" assertion MUST then fail — proving it verifies the
// rejection behavior rather than just any status text.
test("AC2 [mutation]: assertion must fail if the API wrongly accepts", async ({ page }) => {
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, name: "user@test.com" }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Email").fill("user@test.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toHaveText("Invalid credentials");
});
