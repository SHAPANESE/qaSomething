/**
 * Dry-run the REAL agent loop (src/loop.ts) with a scripted model instead of an
 * LLM. This validates all the machinery we never actually executed — the loop,
 * shell guardrails, the git-backed write-allowlist, observation, and finish —
 * so the only unknown left for a real run is the LLM's judgment, not the plumbing.
 */
import { execa } from "execa";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/config.js";
import { runAgent } from "../src/loop.js";
import type { Model } from "../src/model.js";
import type { Message } from "../src/types.js";

class ScriptedModel implements Model {
  readonly id = "scripted";
  private i = 0;
  constructor(private readonly turns: string[]) {}
  async generate(_system: string, _messages: Message[]): Promise<string> {
    return this.turns[this.i++] ?? "```done\nend of script\n```";
  }
}

const repo = await mkdtemp(path.join(os.tmpdir(), "qa-agent-dryrun-"));
await writeFile(path.join(repo, "server.mjs"), "console.log('app under test');\n");
await execa("git", ["init", "-q"], { cwd: repo });
await execa("git", ["add", "-A"], { cwd: repo });
await execa("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });

const turns = [
  "Orienting.\n```bash\nls -a && cat server.mjs\n```",
  "Writing a test (allowed).\n```bash\nmkdir -p tests && printf \"import { test, expect } from '@playwright/test';\\ntest('ok', async () => { expect(1).toBe(1); });\\n\" > tests/gen.spec.ts && echo wrote\n```",
  "Trying to edit app source (guard should REVERT this).\n```bash\necho '// injected by agent' >> server.mjs && echo edited\n```",
  "Trying a dangerous command (guard should BLOCK this).\n```bash\nrm -rf /tmp/qa-agent-should-be-blocked\n```",
  "```done\nWrote tests/gen.spec.ts; attempted an app-source edit and a dangerous command.\n```",
];

const config = resolveConfig(repo, { maxSteps: 10, commandTimeoutMs: 30_000 });
const result = await runAgent({
  model: new ScriptedModel(turns),
  mission: "Dry run of the agent machinery.",
  criteriaManual: "(criteria omitted for dry run)",
  config,
});

// --- Assertions on the REAL machinery -----------------------------------------
const serverText = await readFile(path.join(repo, "server.mjs"), "utf8");
const testWritten = existsSync(path.join(repo, "tests", "gen.spec.ts"));
const appEditReverted = !serverText.includes("injected");
const blockedStep = result.steps.find((s) => s.result?.blocked === true);
const revertStep = result.steps.find((s) => (s.result?.revertedPaths.length ?? 0) > 0);

const checks: [string, boolean][] = [
  ["loop finished cleanly", result.finished],
  ["test file written to tests/ (allowed)", testWritten],
  ["app-source edit was REVERTED by the guard", appEditReverted],
  ["guard reported the revert", revertStep !== undefined && revertStep.result!.revertedPaths.includes("server.mjs")],
  ["dangerous command was BLOCKED", blockedStep !== undefined],
];

console.log(`\nDry run in ${repo}\n${"─".repeat(60)}`);
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`${ok ? "✔" : "✗"} ${label}`);
  if (!ok) allOk = false;
}
console.log("─".repeat(60));
console.log(allOk ? "ALL MACHINERY CHECKS PASSED" : "SOME CHECKS FAILED");
if (!allOk) process.exitCode = 1;
