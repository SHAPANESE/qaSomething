/**
 * Drives the real trust gates (src/verify.ts) against the login-app fixture —
 * the same code the CLI runs after an agent finishes. No API key needed: this
 * exercises the verification layer end-to-end against real Playwright runs.
 */
import path from "node:path";
import { playwrightRunner, verifyAll } from "../src/verify.js";

const repo = path.resolve("fixtures/login-app");
const specs = [
  "tests/valid-login.spec.ts",
  "tests/valid-login.mutation.spec.ts",
  "tests/wrong-password.spec.ts",
  "tests/wrong-password.mutation.spec.ts",
  "tests/smoke.spec.ts",
  "tests/smoke.mutation.spec.ts",
].map((p) => path.join(repo, p));

const runner = playwrightRunner(repo, 120_000);
const verdicts = await verifyAll(specs, 2, runner);

console.log("\n" + "═".repeat(64));
console.log("TRUST GATES — verdict per test (quarantine ×2 + mutation polarity)");
console.log("═".repeat(64));
let rejected = 0;
for (const v of verdicts) {
  console.log(`\n${v.trusted ? "✔ TRUSTED " : "✗ REJECTED"}  ${path.basename(v.spec)}`);
  for (const reason of v.reasons) console.log(`   · ${reason}`);
  if (!v.trusted) rejected++;
}
console.log(`\n${"═".repeat(64)}`);
console.log(`${verdicts.length} tests · ${verdicts.length - rejected} trusted · ${rejected} rejected`);
