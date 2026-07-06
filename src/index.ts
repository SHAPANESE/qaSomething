#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type RunConfig } from "./config.js";
import { runAgent } from "./loop.js";
import { createAnthropicModel } from "./model.js";
import type { Step } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CRITERIA = path.resolve(HERE, "..", "docs", "qa-senior-criteria.md");

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

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("qa-agent")
    .description("A senior-QA-minded agent that generates trustworthy Playwright tests.")
    .argument("<mission>", 'What to test, e.g. "Test the login flow"')
    .requiredOption("-r, --repo <path>", "Path to the repo under test")
    .option("-c, --criteria <path>", "Path to the senior-QA criteria manual", DEFAULT_CRITERIA)
    .option("-m, --model <id>", "Anthropic model id")
    .option("--max-steps <n>", "Max loop iterations", (v) => Number.parseInt(v, 10))
    .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
    .parse();

  const mission = program.args[0] as string;
  const opts = program.opts<{
    repo: string;
    criteria: string;
    model?: string;
    maxSteps?: number;
    timeout?: number;
  }>();

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

  console.log(`qa-agent · model=${config.modelId} · repo=${config.repoPath}`);
  console.log(`mission: ${mission}`);

  const result = await runAgent({ model, mission, criteriaManual, config, onStep: renderStep });

  console.log("\n" + "─".repeat(60));
  if (result.finished) {
    console.log(`✔ Mission complete in ${result.stepCount} steps.\n`);
    console.log(result.summary ?? "(no summary)");
  } else {
    console.log(`✗ Stopped: ${result.stoppedReason}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
