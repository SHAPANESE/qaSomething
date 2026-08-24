import { test, expect } from "@playwright/test";

test.use({"baseURL":"http://127.0.0.1:3200"});


test("creates exactly one visible task [mutation]", async ({ page }, testInfo) => {
  const qaEvidence = {
    channels: ["ui", "network", "console"] as Array<"ui" | "network" | "console" | "screenshot">,
    oracleReached: false,
    responses: [] as Array<{ method: string; url: string; status: number }>,
    console: [] as Array<{ type: string; text: string }>,
    pageErrors: [] as string[],
    cleanupErrors: [] as string[],
    finalUrl: undefined as string | undefined,
    pageTitle: undefined as string | undefined,
  };
  page.on("response", response => qaEvidence.responses.push({
    method: response.request().method(), url: response.url(), status: response.status()
  }));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) qaEvidence.console.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", error => qaEvidence.pageErrors.push(error.message));
  let oraclePassed = false;
  try {

    // mutation â€” Reject task creation at the API boundary
  await page.route("**/api/tasks", async route => { if (route.request().method() === "POST") await route.fulfill({ status: 500, contentType: "application/json", body: '{\"error\":\"mutated\"}' }); else await route.continue(); })

  // action:navigate — Open the task list
  await page.goto("/")

  // action:fill-title — Enter a unique task title
  await page.getByLabel("Title").fill("Evidence task")

  // action:submit — Create the task
  await page.getByRole("button", { name: "Add" }).click()

    // oracle — Exactly one matching task is visible
    qaEvidence.oracleReached = true;
  await expect(page.getByText("Evidence task", { exact: true })).toHaveCount(1)
    await expect(page.getByText("Evidence task", { exact: true })).toBeVisible();
    expect(qaEvidence.responses.some(response => response.method === "POST" && new URL(response.url).pathname === "/api/tasks" && response.status === 201)).toBe(true);
    expect(qaEvidence.pageErrors).toEqual([]);
    oraclePassed = true;
  } finally {
    qaEvidence.finalUrl = page.url();
    qaEvidence.pageTitle = await page.title().catch(() => undefined);
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined);
    if (screenshot !== undefined) {
      qaEvidence.channels.push("screenshot");
      await testInfo.attach("qa-final-page", { body: screenshot, contentType: "image/png" });
    }
    let cleanupError: unknown;
    try {
      // No cleanup actions declared.
    } catch (error) {
      cleanupError = error;
      qaEvidence.cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    console.log("__QA_EVIDENCE__" + JSON.stringify(qaEvidence));
    await testInfo.attach("qa-evidence", { body: JSON.stringify(qaEvidence, null, 2), contentType: "application/json" });
    if (cleanupError !== undefined && oraclePassed) throw cleanupError;
  }
});
