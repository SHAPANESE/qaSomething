#!/usr/bin/env node
import { Command } from "commander";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type RunConfig } from "./config.js";
import { runAgent } from "./loop.js";
import { claudeCliModel, createAnthropicModel } from "./model.js";
import { fileTicketProvider, formatOracle, jiraProviderFromEnv } from "./oracle.js";
import { loadProjectConfig, type ProjectConfig } from "./projectConfig.js";
import type { EnvInfo } from "./prompt.js";
import type { Step } from "./types.js";
import { makeTriageRunner, triageSpec } from "./triage.js";
import { playwrightRunner, verdictToJson, verifyAll, type TestVerdict } from "./verify.js";
import { isGitRepo, listChangedPaths } from "./workspace.js";
import {
  casebookPaths,
  listFindings,
  readCases,
  readGaps,
  readState,
  writeReport,
  writeState,
} from "./casebook/store.js";
import { computeCoverage } from "./casebook/run.js";
import { renderReport } from "./casebook/report.js";
import { setPhase } from "./casebook/state.js";
import {
  contractResultToJson,
  runContract,
  schemathesisRunner,
  type GenerationMode,
  type SchemathesisOptions,
} from "./api/schemathesis.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CRITERIA = path.resolve(HERE, "..", "docs", "qa-senior-criteria.md");

function inAllowed(relPath: string, dirs: string[]): boolean {
  const p = relPath.split(path.sep).join("/");
  return dirs.some((d) => p === d || p.startsWith(d.replace(/\/$/, "") + "/"));
}

/** Merge config: built-in defaults < qa-agent.config.json < CLI flags. */
async function buildConfig(
  repoPath: string,
  cli: Partial<RunConfig>,
): Promise<{ config: RunConfig; project: ProjectConfig | null }> {
  const project = await loadProjectConfig(repoPath);
  const merged: Partial<RunConfig> = {};
  if (project?.allowedWriteDirs) merged.allowedWriteDirs = project.allowedWriteDirs;
  if (project?.reruns) merged.reruns = project.reruns;
  if (project?.commandTimeoutMs) merged.commandTimeoutMs = project.commandTimeoutMs;
  if (project?.maxSteps) merged.maxSteps = project.maxSteps;
  if (project?.model) merged.modelId = project.model;
  Object.assign(merged, cli);
  return { config: resolveConfig(repoPath, merged), project };
}

function envFrom(project: ProjectConfig | null): EnvInfo | undefined {
  if (!project) return undefined;
  const env: EnvInfo = {};
  if (project.startCommand !== undefined) env.startCommand = project.startCommand;
  if (project.baseUrl !== undefined) env.baseUrl = project.baseUrl;
  return env.startCommand === undefined && env.baseUrl === undefined ? undefined : env;
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

async function runGates(config: RunConfig, specFiles: string[], json = false): Promise<boolean> {
  if (specFiles.length === 0) {
    if (json) console.log("[]");
    else console.log("No test files to verify.");
    return true;
  }
  const runner = playwrightRunner(config.repoPath, config.commandTimeoutMs);
  let verdicts: TestVerdict[];
  try {
    if (!json)
      console.log(
        `\n${"─".repeat(60)}\nVerifying ${specFiles.length} spec file(s) — quarantine ×${config.reruns} + mutation…`,
      );
    verdicts = await verifyAll(specFiles, config.reruns, runner);
  } catch (err) {
    console.warn(`⚠ Verification could not run (is the app + Playwright runnable?): ${String(err)}`);
    return true;
  }

  if (json) {
    console.log(JSON.stringify(verdicts.map(verdictToJson), null, 2));
    return verdicts.every((v) => v.trusted);
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
  subscription?: boolean;
}

async function runAgentAction(mission: string, opts: RunOpts): Promise<void> {
  if (opts.subscription !== true && !process.env["ANTHROPIC_API_KEY"]) {
    console.error("Error: ANTHROPIC_API_KEY is not set. Export it, or use --subscription (Claude Code CLI).");
    process.exitCode = 1;
    return;
  }

  const criteriaManual = await readFile(opts.criteria, "utf8");
  const overrides: Partial<RunConfig> = {};
  if (opts.model !== undefined) overrides.modelId = opts.model;
  if (opts.maxSteps !== undefined) overrides.maxSteps = opts.maxSteps;
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const { config, project } = await buildConfig(path.resolve(opts.repo), overrides);
  const model = opts.subscription === true ? claudeCliModel() : createAnthropicModel(config.modelId);
  const env = envFrom(project);

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
    console.warn(
      "⚠ No --ticket/--jira: the agent has no source of truth and may encode current behavior (bugs included) as expected.",
    );
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
    ...(env !== undefined ? { env } : {}),
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
  json?: boolean;
}

async function verifyAction(opts: VerifyOpts): Promise<void> {
  const overrides: Partial<RunConfig> = {};
  if (opts.reruns !== undefined) overrides.reruns = opts.reruns;
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const { config } = await buildConfig(path.resolve(opts.repo), overrides);
  const specs = await discoverSpecs(config, opts.all === true);
  const ok = await runGates(config, specs, opts.json === true);
  if (!ok) process.exitCode = 1;
}

interface TriageOpts {
  repo: string;
  spec?: string;
  reruns?: number;
  timeout?: number;
  all?: boolean;
}

async function triageAction(opts: TriageOpts): Promise<void> {
  const overrides: Partial<RunConfig> = {};
  if (opts.reruns !== undefined) overrides.reruns = opts.reruns;
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const { config } = await buildConfig(path.resolve(opts.repo), overrides);

  const specs =
    opts.spec !== undefined
      ? [path.join(config.repoPath, opts.spec)]
      : (await discoverSpecs(config, opts.all !== false)).filter((s) => !s.endsWith(".mutation.spec.ts"));

  if (specs.length === 0) {
    console.log("No specs to triage.");
    return;
  }
  const runner = makeTriageRunner(config.repoPath, config.commandTimeoutMs);
  for (const spec of specs) {
    const t = await triageSpec(spec, config.reruns, runner);
    console.log(`\n${t.class.toUpperCase()}  ${t.spec}`);
    console.log(`   evidence: ${t.evidence}`);
    console.log(`   → ${t.recommendation}`);
  }
}

interface ReportOpts {
  repo: string;
  ticket?: string;
  date?: string;
}

async function reportAction(opts: ReportOpts): Promise<void> {
  const repo = path.resolve(opts.repo);
  const cases = await readCases(repo);
  const gaps = await readGaps(repo);
  const findings = await listFindings(repo);
  const state = await readState(repo);

  const ticketIds = Object.keys(state.tickets);
  let ticketId = opts.ticket;
  if (ticketId === undefined) {
    if (ticketIds.length === 0) {
      throw new Error("No tickets tracked in this casebook; run qa-plan first, or pass --ticket <id>.");
    }
    if (ticketIds.length > 1) {
      throw new Error(`Multiple tickets in the casebook (${ticketIds.join(", ")}); pass --ticket <id>.`);
    }
    ticketId = ticketIds[0]!;
  }

  // One clock read for the whole action, so the report date and the state
  // timestamp can't disagree across a midnight boundary.
  const now = new Date();
  const date = opts.date ?? now.toISOString().slice(0, 10);
  const markdown = renderReport({ ticketId, date, cases, coverage: computeCoverage(cases), gaps, findings });
  await writeReport(repo, markdown);

  // Advance the ticket to the final phase, if it's tracked in the casebook.
  if (state.tickets[ticketId]) {
    await writeState(repo, setPhase(state, ticketId, "reported", now.toISOString()));
  }

  console.log(markdown);
  console.error(`✔ wrote ${casebookPaths(repo).report}`);
}

interface ApiOpts {
  repo: string;
  spec: string;
  url?: string;
  checks?: string;
  mode?: string;
  maxExamples?: number;
  case?: string;
  json?: boolean;
  timeout?: number;
}

const GEN_MODES: GenerationMode[] = ["positive", "negative", "all"];

async function apiAction(opts: ApiOpts): Promise<void> {
  const overrides: Partial<RunConfig> = {};
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const { config, project } = await buildConfig(path.resolve(opts.repo), overrides);

  const url = opts.url ?? project?.baseUrl;
  if (url === undefined) {
    console.error("Error: no --url given and no baseUrl in qa-agent.config.json.");
    process.exitCode = 1;
    return;
  }
  if (opts.mode !== undefined && !GEN_MODES.includes(opts.mode as GenerationMode)) {
    console.error(`Error: --mode must be one of ${GEN_MODES.join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  const specPath = path.isAbsolute(opts.spec) ? opts.spec : path.join(config.repoPath, opts.spec);
  const options: SchemathesisOptions = {
    spec: specPath,
    url,
    ...(opts.checks ? { checks: opts.checks.split(",").map((c) => c.trim()) } : {}),
    ...(opts.mode ? { mode: opts.mode as GenerationMode } : {}),
    ...(opts.maxExamples !== undefined ? { maxExamples: opts.maxExamples } : {}),
  };

  const runner = schemathesisRunner(config.repoPath, config.commandTimeoutMs);
  const result = await runContract(options, runner).catch((err: unknown) => {
    console.error(`⚠ Contract run could not execute (is uvx/schemathesis available?): ${String(err)}`);
    return null;
  });
  if (result === null) return;

  if (opts.json === true) {
    console.log(JSON.stringify(contractResultToJson(result), null, 2));
    if (!result.passed && result.inconclusive !== true) process.exitCode = 1;
    return;
  }

  console.log(`\nContract: ${opts.spec}  →  ${url}`);
  if (result.inconclusive === true) {
    console.log(
      "⚠ inconclusive — could not run the contract (schema didn't load, no operations, or Schemathesis is missing). This is an environment problem, not a violation.",
    );
    const tail = result.output.trim().split("\n").slice(-6).join("\n");
    if (tail) console.log(tail.replace(/^/gm, "   "));
    return;
  }

  for (const op of result.report?.operations ?? []) {
    const bad = op.failures.length > 0;
    console.log(
      `\n${bad ? "✗" : "✔"} ${op.operation}${bad ? `  — ${op.failures.length} contract violation(s)` : ""}`,
    );
    for (const f of op.failures) {
      console.log(`   · [${f.check}] ${f.message}`);
      if (f.curl) console.log(`     repro: ${f.curl}`);
    }
  }
  console.log(
    `\n${result.passed ? "✔ contract upheld" : "✗ contract violated"} — ${result.report?.tests ?? 0} operation(s) tested, ${result.failures.length} violation(s).`,
  );
  if (opts.case && result.failures.length > 0) {
    console.log(
      `   → these violations map to case ${opts.case}; a violation is a behavior-regression → file with qa-bug.`,
    );
  }
  if (!result.passed) process.exitCode = 1;
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
  .option("--subscription", "Use the Claude Code CLI (subscription) instead of ANTHROPIC_API_KEY")
  .action(runAgentAction);

program
  .command("verify")
  .description("Verify existing tests with the trust gates (quarantine + mutation), no agent")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .option("--reruns <n>", "Quarantine re-runs per test", (v) => Number.parseInt(v, 10))
  .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--all", "Verify all specs under the write dirs, not just git-changed ones")
  .option("--json", "Emit machine-readable JSON verdicts (for CI)")
  .action(verifyAction);

program
  .command("triage")
  .description("Mission #6: classify why a failing test fails (flaky / locator-drift / regression)")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .option("-s, --spec <path>", "A single spec (repo-relative) to triage")
  .option("--reruns <n>", "Runs used for flakiness detection", (v) => Number.parseInt(v, 10))
  .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--all", "Triage all specs (default when --spec is omitted)")
  .action(triageAction);

program
  .command("report")
  .description("Render the QA sign-off summary from the casebook to .qa-agent/report.md")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .option("-t, --ticket <id>", "Ticket id (defaults to the sole ticket in the casebook)")
  .option("--date <iso>", "Date stamp for the report (defaults to today)")
  .action(reportAction);

program
  .command("api")
  .description("Contract-test an API against its OpenAPI/GraphQL spec with Schemathesis (the oracle)")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .requiredOption("-s, --spec <path>", "OpenAPI/GraphQL contract (repo-relative or absolute)")
  .option("-u, --url <base>", "Base URL of the running API (defaults to baseUrl in qa-agent.config.json)")
  .option("--checks <list>", "Comma-separated Schemathesis checks (default: a curated contract set)")
  .option("--mode <mode>", "Generation mode: positive | negative | all (default: all)")
  .option("--max-examples <n>", "Examples generated per check", (v) => Number.parseInt(v, 10))
  .option("--case <id>", "Case id these operations map to (for casebook traceability)")
  .option("--json", "Emit machine-readable JSON (for CI / qa-run)")
  .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
  .action(apiAction);

program.parseAsync().catch((err: unknown) => {
  // Expected failures (bad config, missing ticket, …) get a clean message; only
  // truly unexpected errors show a stack, and only when DEBUG is set.
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env["DEBUG"] && err instanceof Error) console.error(err.stack);
  process.exitCode = 1;
});
