// case: TC-TASK-7-01
import { test, expect } from "@playwright/test";

// Mutation proof for AC1. We break the create API via network interception
// (no app-source edit). The task must then NOT appear — proving the real test
// verifies that the task was actually added, not just that the page rendered.
test("AC1 [mutation]: the task must not appear when the create API is broken", async ({ page }) => {
  await page.route("**/api/tasks", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "boom" }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Title").fill("Buy milk");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Buy milk");
});
