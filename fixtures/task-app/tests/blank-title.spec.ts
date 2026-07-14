// case: TC-TASK-7-02
import { test, expect } from "@playwright/test";

// TASK-7 AC2: a whitespace-only title is rejected with a specific message and
// adds nothing to the list.
test("AC2: a blank title shows 'Title is required' and adds nothing", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Title").fill("   ");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status")).toHaveText("Title is required");
  await expect(page.getByRole("listitem")).toHaveCount(0);
});
