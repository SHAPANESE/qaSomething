#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type RunConfig } from "./config.js";
import { runAgent } from "./loop.js";
import { createAnthropicModel } from "./model.js";
import { fileTicketProvider, formatOracle } from "./oracle.js";
import type { Step } from "./types.js";
import { playwrightRunner, verifyAll, type TestVerdict } from "./verify.js";
import { listChangedPaths } from "./workspace.js";

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
    .option("-t, --ticket <ref>", "Ticket file that defines expected behavior (the oracle)")
    .option("-c, --criteria <path>", "Path to the senior-QA criteria manual", DEFAULT_CRITERIA)
    .option("-m, --model <id>", "Anthropic model id")
    .option("--max-steps <n>", "Max loop iterations", (v) => Number.parseInt(v, 10))
    .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
    .option("--skip-verify", "Skip the post-run trust gates (quarantine + mutation)")
    .parse();

  const mission = program.args[0] as string;
  const opts = program.opts<{
    repo: string;
    ticket?: string;
    criteria: string;
    model?: string;
    maxSteps?: number;
    timeout?: number;
    skipVerify?: boolean;
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

  let oracle: string | undefined;
  if (opts.ticket !== undefined) {
    const ticket = await fileTicketProvider.load(opts.ticket);
    oracle = formatOracle(ticket);
    console.log(`oracle: ticket ${ticket.id} — ${ticket.title}`);
  } else {
    console.warn("⚠ No --ticket given: the agent has no source of truth and may encode current behavior (bugs included) as expected.");
  }

  console.log(`qa-agent · model=${config.modelId} · repo=${config.repoPath}`);
  console.log(`mission: ${mission}`);

  const result = await runAgent({
    model,
    mission,
    criteriaManual,
    config,
    onStep: renderStep,
    ...(oracle !== undefined ? { oracle } : {}),
  });

  console.log("\n" + "─".repeat(60));
  if (result.finished) {
    console.log(`✔ Agent finished in ${result.stepCount} steps.\n`);
    console.log(result.summary ?? "(no summary)");
  } else {
    console.log(`✗ Stopped: ${result.stoppedReason}`);
    process.exitCode = 1;
    return;
  }

  if (opts.skipVerify) return;
  await verifyProducedTests(config);
}

/** Post-run trust gates: quarantine (re-run N times) + mutation polarity. */
async function verifyProducedTests(config: RunConfig): Promise<void> {
  const changed = await listChangedPaths(config.repoPath);
  const specFiles = changed
    .filter((p) => p.endsWith(".spec.ts"))
    .filter((p) => config.allowedWriteDirs.some((d) => p === d || p.startsWith(d.replace(/\/$/, "") + "/")))
    .map((p) => path.join(config.repoPath, p));

  if (specFiles.length === 0) {
    console.log("\nNo new test files to verify.");
    return;
  }

  console.log(`\n${"─".repeat(60)}\nVerifying ${specFiles.length} test file(s) — quarantine ×${config.reruns} + mutation…`);
  const runner = playwrightRunner(config.repoPath, config.commandTimeoutMs);
  let verdicts: TestVerdict[];
  try {
    verdicts = await verifyAll(specFiles, config.reruns, runner);
  } catch (err) {
    console.warn(`⚠ Verification could not run (is the app + Playwright runnable?): ${String(err)}`);
    return;
  }

  let anyUntrusted = false;
  for (const v of verdicts) {
    const label = v.trusted ? "✔ TRUSTED" : "✗ REJECTED";
    console.log(`\n${label}  ${v.spec}`);
    for (const reason of v.reasons) console.log(`   · ${reason}`);
    if (!v.trusted) anyUntrusted = true;
  }
  if (anyUntrusted) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
