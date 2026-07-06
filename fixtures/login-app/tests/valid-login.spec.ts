import { test, expect } from "@playwright/test";

// PROJ-42 AC1: valid credentials show a welcome message.
test("AC1: valid credentials show a welcome message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("user@test.com");
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toHaveText("Welcome, user@test.com");
});
