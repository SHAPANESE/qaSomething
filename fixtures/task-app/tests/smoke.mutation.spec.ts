import { test, expect } from "@playwright/test";

// Mutation proof for the hollow smoke test. We break the create API — yet this
// test STILL passes, because it never asserts on add-task behavior. That passing
// mutation is exactly what tells the gate the smoke test is not meaningful.
test("smoke [mutation]: still passes with the API broken (that is the problem)", async ({ page }) => {
  await page.route("**/api/tasks", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.goto("/");
  await expect(page).toHaveTitle("Tasks");
  await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
});
