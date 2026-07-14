// case: TC-TASK-7-02
import { test, expect } from "@playwright/test";

// Mutation proof for AC2. We make the API wrongly ACCEPT the blank title. The
// "Title is required" assertion MUST then fail — proving it verifies the
// rejection behavior rather than just any status text.
test("AC2 [mutation]: assertion must fail if the API wrongly accepts a blank title", async ({ page }) => {
  await page.route("**/api/tasks", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, task: { title: "(accepted)", priority: "low" } }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Title").fill("   ");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status")).toHaveText("Title is required");
});
