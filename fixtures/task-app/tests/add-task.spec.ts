// case: TC-TASK-7-01
import { test, expect } from "@playwright/test";

// TASK-7 AC1: a non-empty title is added to the task list.
test("AC1: adding a task shows it in the list", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Title").fill("Buy milk");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Buy milk");
});
