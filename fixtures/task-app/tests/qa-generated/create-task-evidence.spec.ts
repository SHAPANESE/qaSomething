import { test, expect } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3200" });

test("creates exactly one visible task", async ({ page }, testInfo) => {
  const qaEvidence = {
    channels: ["ui", "network", "console"] as Array<"ui" | "network" | "console" | "screenshot">,
    oracleReached: false,
    responses: [] as Array<{ method: string; url: string; status: number }>,
    console: [] as Array<{ type: string; text: string }>,
    pageErrors: [] as string[],
    finalUrl: undefined as string | undefined,
    pageTitle: undefined as string | undefined,
  };
  page.on("response", (response) =>
    qaEvidence.responses.push({
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
    }),
  );
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      qaEvidence.console.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => qaEvidence.pageErrors.push(error.message));
  try {
    // action:navigate — Open the task list
    await page.goto("/");

    // action:fill-title — Enter a unique task title
    await page.getByLabel("Title").fill("Evidence task");

    // action:submit — Create the task
    await page.getByRole("button", { name: "Add" }).click();

    // oracle — Exactly one matching task is visible
    qaEvidence.oracleReached = true;
    await expect(page.getByText("Evidence task", { exact: true })).toHaveCount(1);
  } finally {
    qaEvidence.finalUrl = page.url();
    qaEvidence.pageTitle = await page.title().catch(() => undefined);
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined);
    if (screenshot !== undefined) {
      qaEvidence.channels.push("screenshot");
      await testInfo.attach("qa-final-page", { body: screenshot, contentType: "image/png" });
    }
    console.log("__QA_EVIDENCE__" + JSON.stringify(qaEvidence));
    await testInfo.attach("qa-evidence", {
      body: JSON.stringify(qaEvidence, null, 2),
      contentType: "application/json",
    });
  }
});
