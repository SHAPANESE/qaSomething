import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";
import { runAgent } from "./loop.js";
import type { Model } from "./model.js";

/**
 * Integration test for the REAL agent machinery: loop.ts + shell.ts (runCommand)
 * + workspace.ts (git write-guard) working together, driven by a scripted model.
 * Covers the safety-critical paths our unit tests can't reach in isolation, and
 * runs in CI (unlike the dry-run script).
 */

class ScriptedModel implements Model {
  readonly id = "scripted";
  private i = 0;
  constructor(private readonly turns: string[]) {}
  async generate(): Promise<string> {
    return this.turns[this.i++] ?? "```done\nend\n```";
  }
}

const TURNS = [
  "```bash\nmkdir -p tests && printf \"import { test } from '@playwright/test';\\n\" > tests/gen.spec.ts && echo wrote\n```",
  "```bash\necho '// injected' >> server.mjs && echo edited\n```",
  "```bash\nrm -rf /tmp/qa-agent-int-should-be-blocked\n```",
  "```done\ndone\n```",
];

async function setupRepo(subdir: string | null): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-agent-int-"));
  const appDir = subdir ? path.join(root, subdir) : root;
  if (subdir) await execa("mkdir", ["-p", appDir]);
  await writeFile(path.join(appDir, "server.mjs"), "console.log('app');\n");
  await execa("git", ["init", "-q"], { cwd: root });
  await execa("git", ["add", "-A"], { cwd: root });
  await execa("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root });
  return appDir;
}

async function runScenario(repoPath: string) {
  const config = resolveConfig(repoPath, { maxSteps: 10, commandTimeoutMs: 30_000 });
  const result = await runAgent({
    model: new ScriptedModel(TURNS),
    mission: "integration",
    criteriaManual: "(none)",
    config,
  });
  const serverText = await readFile(path.join(repoPath, "server.mjs"), "utf8");
  return { result, serverText };
}

describe("agent machinery (integration)", () => {
  it("enforces guardrails when the repo IS the git root", async () => {
    const repo = await setupRepo(null);
    const { result, serverText } = await runScenario(repo);

    expect(result.finished).toBe(true);
    expect(existsSync(path.join(repo, "tests", "gen.spec.ts"))).toBe(true); // allowed write persists
    expect(serverText).not.toContain("injected"); // app-source edit reverted
    expect(result.steps.some((s) => s.result?.blocked === true)).toBe(true); // dangerous cmd blocked
    expect(result.steps.some((s) => s.result?.revertedPaths.includes("server.mjs"))).toBe(true);
  }, 60_000);

  it("enforces guardrails when the app is a monorepo SUBDIR", async () => {
    const repo = await setupRepo("packages/app");
    const { result, serverText } = await runScenario(repo);

    expect(result.finished).toBe(true);
    expect(existsSync(path.join(repo, "tests", "gen.spec.ts"))).toBe(true);
    expect(serverText).not.toContain("injected"); // reverted despite the subdir prefix
    expect(result.steps.some((s) => s.result?.revertedPaths.includes("server.mjs"))).toBe(true);
  }, 60_000);
});
