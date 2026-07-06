#!/usr/bin/env node
import { Command } from "commander";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type RunConfig } from "./config.js";
import { runAgent } from "./loop.js";
import { createAnthropicModel } from "./model.js";
import { fileTicketProvider, formatOracle, jiraProviderFromEnv } from "./oracle.js";
import type { Step } from "./types.js";
import { playwrightRunner, verifyAll, type TestVerdict } from "./verify.js";
import { isGitRepo, listChangedPaths } from "./workspace.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CRITERIA = path.resolve(HERE, "..", "docs", "qa-senior-criteria.md");

function inAllowed(relPath: string, dirs: string[]): boolean {
  const p = relPath.split(path.sep).join("/");
  return dirs.some((d) => p === d || p.startsWith(d.replace(/\/$/, "") + "/"));
}

function renderStep(step: Step): void {
  const { action } = step;
  if (action.kind === "command") {
    const first = action.command.split("\n")[0] ?? "";
    const preview = first.length > 100 ? first.slice(0, 100) + "…" : first;
    const status = step.result?.blocked
      ? "BLOCKED"
      : step.result?.timedOut
        ? "TIMEOUT"
        : `exit ${step.result?.exitCode}`;
    console.log(`\n[${step.index}] $ ${preview}   (${status})`);
    if (step.result && step.result.revertedPaths.length > 0) {
      console.log(`    ↩ guardrail reverted: ${step.result.revertedPaths.join(", ")}`);
    }
  } else if (action.kind === "finish") {
    console.log(`\n[${step.index}] ✔ finished`);
  } else {
    console.log(`\n[${step.index}] ⚠ protocol: ${action.reason}`);
  }
}

/** Find spec files to verify: git-changed ones by default, or all under the write dirs. */
async function discoverSpecs(config: RunConfig, all: boolean): Promise<string[]> {
  if (!all && (await isGitRepo(config.repoPath))) {
    const changed = await listChangedPaths(config.repoPath);
    return changed
      .filter((p) => p.endsWith(".spec.ts") && inAllowed(p, config.allowedWriteDirs))
      .map((p) => path.join(config.repoPath, p));
  }
  const found: string[] = [];
  for (const dir of config.allowedWriteDirs) {
    const abs = path.join(config.repoPath, dir);
    try {
      for (const entry of await readdir(abs, { recursive: true })) {
        const name = String(entry);
        if (name.endsWith(".spec.ts")) found.push(path.join(abs, name));
      }
    } catch {
      /* directory may not exist */
    }
  }
  return found;
}

async function runGates(config: RunConfig, specFiles: string[]): Promise<boolean> {
  if (specFiles.length === 0) {
    console.log("No test files to verify.");
    return true;
  }
  console.log(`\n${"─".repeat(60)}\nVerifying ${specFiles.length} spec file(s) — quarantine ×${config.reruns} + mutation…`);
  const runner = playwrightRunner(config.repoPath, config.commandTimeoutMs);
  let verdicts: TestVerdict[];
  try {
    verdicts = await verifyAll(specFiles, config.reruns, runner);
  } catch (err) {
    console.warn(`⚠ Verification could not run (is the app + Playwright runnable?): ${String(err)}`);
    return true;
  }
  let anyUntrusted = false;
  for (const v of verdicts) {
    console.log(`\n${v.trusted ? "✔ TRUSTED " : "✗ REJECTED"}  ${path.basename(v.spec)}`);
    for (const reason of v.reasons) console.log(`   · ${reason}`);
    if (!v.trusted) anyUntrusted = true;
  }
  return !anyUntrusted;
}

interface RunOpts {
  repo: string;
  ticket?: string;
  jira?: string;
  criteria: string;
  model?: string;
  maxSteps?: number;
  timeout?: number;
  skipVerify?: boolean;
  repair?: boolean;
}

async function runAgentAction(mission: string, opts: RunOpts): Promise<void> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Error: ANTHROPIC_API_KEY is not set. Export it before running.");
    process.exitCode = 1;
    return;
  }

  const criteriaManual = await readFile(opts.criteria, "utf8");
  const overrides: Partial<RunConfig> = {};
  if (opts.model !== undefined) overrides.modelId = opts.model;
  if (opts.maxSteps !== undefined) overrides.maxSteps = opts.maxSteps;
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const config = resolveConfig(path.resolve(opts.repo), overrides);
  const model = createAnthropicModel(config.modelId);

  let oracle: string | undefined;
  if (opts.jira !== undefined) {
    const provider = jiraProviderFromEnv(process.env);
    if (provider === null) {
      console.error("Error: --jira needs JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in the environment.");
      process.exitCode = 1;
      return;
    }
    const ticket = await provider.load(opts.jira);
    oracle = formatOracle(ticket);
    console.log(`oracle: Jira ${ticket.id} — ${ticket.title}`);
  } else if (opts.ticket !== undefined) {
    const ticket = await fileTicketProvider.load(opts.ticket);
    oracle = formatOracle(ticket);
    console.log(`oracle: ticket ${ticket.id} — ${ticket.title}`);
  } else {
    console.warn("⚠ No --ticket/--jira: the agent has no source of truth and may encode current behavior (bugs included) as expected.");
  }

  console.log(`qa-agent · model=${config.modelId} · repo=${config.repoPath}\nmission: ${mission}`);
  const result = await runAgent({
    model,
    mission,
    criteriaManual,
    config,
    onStep: renderStep,
    ...(oracle !== undefined ? { oracle } : {}),
    ...(opts.repair === true ? { repair: true } : {}),
  });

  console.log("\n" + "─".repeat(60));
  if (!result.finished) {
    console.log(`✗ Stopped: ${result.stoppedReason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✔ Agent finished in ${result.stepCount} steps.\n\n${result.summary ?? "(no summary)"}`);

  if (opts.skipVerify) return;
  const specs = await discoverSpecs(config, false);
  const ok = await runGates(config, specs);
  if (!ok) process.exitCode = 1;
}

interface VerifyOpts {
  repo: string;
  reruns?: number;
  timeout?: number;
  all?: boolean;
}

async function verifyAction(opts: VerifyOpts): Promise<void> {
  const overrides: Partial<RunConfig> = {};
  if (opts.reruns !== undefined) overrides.reruns = opts.reruns;
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const config = resolveConfig(path.resolve(opts.repo), overrides);
  const specs = await discoverSpecs(config, opts.all === true);
  const ok = await runGates(config, specs);
  if (!ok) process.exitCode = 1;
}

const program = new Command();
program.name("qa-agent").description("A senior-QA-minded agent that generates trustworthy Playwright tests.");

program
  .command("run <mission>", { isDefault: true })
  .description("Run the QA agent to generate tests, then verify them")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .option("-t, --ticket <ref>", "Ticket file that defines expected behavior (the oracle)")
  .option("-j, --jira <key>", "Jira issue key as the oracle (needs JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN)")
  .option("-c, --criteria <path>", "Path to the senior-QA criteria manual", DEFAULT_CRITERIA)
  .option("-m, --model <id>", "Anthropic model id")
  .option("--max-steps <n>", "Max loop iterations", (v) => Number.parseInt(v, 10))
  .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--skip-verify", "Skip the post-run trust gates")
  .option("--repair", "Mission #2: repair failing tests (self-healing) instead of generating")
  .action(runAgentAction);

program
  .command("verify")
  .description("Verify existing tests with the trust gates (quarantine + mutation), no agent")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .option("--reruns <n>", "Quarantine re-runs per test", (v) => Number.parseInt(v, 10))
  .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--all", "Verify all specs under the write dirs, not just git-changed ones")
  .action(verifyAction);

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
