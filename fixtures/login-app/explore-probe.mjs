// Perception-layer demo: instrument the page, drive an action, and surface ranked
// anomalies via the pure classifier (src/explore/anomaly.ts). Proves the sensor
// catches the latent console.error smell that no ticket mentions, while filtering
// the browser's expected-401 echo.
//
// Run: pnpm build, start the app (node server.mjs), then `node explore-probe.mjs`.
import { chromium } from "@playwright/test";
import { classifyAnomalies } from "../../dist/explore/anomaly.js";

const events = [];
const browser = await chromium.launch();
const page = await browser.newPage();

page.on("console", (m) => events.push({ type: "console", level: m.type(), text: m.text() }));
page.on("pageerror", (err) => events.push({ type: "pageerror", message: String(err) }));
page.on("response", (r) => events.push({ type: "response", url: r.url(), status: r.status(), ms: 0 }));
page.on("requestfailed", (r) =>
  events.push({ type: "requestfailed", url: r.url(), failure: r.failure()?.errorText ?? "" }),
);

await page.goto("http://localhost:3100/");
await page.getByLabel("Email").fill("user@test.com");
await page.getByLabel("Password").fill("wrong");
await page.getByRole("button", { name: "Log in" }).click();
await page.waitForTimeout(300);
await browser.close();

const anomalies = classifyAnomalies(events);
console.log(`anomalies found: ${anomalies.length}`);
for (const a of anomalies) console.log(`  [${a.severity}] ${a.kind}: ${a.detail}`);
