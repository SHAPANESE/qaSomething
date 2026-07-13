// case: TC-PROJ-42-02
import { test, expect } from "@playwright/test";

// PROJ-42 AC2: a correct email with a wrong password shows "Invalid credentials".
test("AC2: a wrong password shows Invalid credentials", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("user@test.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toHaveText("Invalid credentials");
});
