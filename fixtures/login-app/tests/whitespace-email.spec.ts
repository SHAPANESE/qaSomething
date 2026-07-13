// case: TC-PROJ-42-04
import { test, expect } from "@playwright/test";

// PROJ-42 boundary (see .qa-agent/gaps.md — the ticket does not define
// trimming behavior): a whitespace-only email is not trimmed client-side, so
// it is treated as a non-empty value and falls through to the generic
// "Invalid credentials" path rather than the AC3 "Email is required" message.
test("boundary: whitespace-only email falls through to Invalid credentials", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(" ");
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toHaveText("Invalid credentials");
});
