#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolveConfig, type RunConfig } from "./config.js";
import { runAgent } from "./loop.js";
import { claudeCliModel, claudeCliTextModel, createAnthropicModel } from "./model.js";
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
import { loadTask, type QATask } from "./task/schema.js";
import { runTask } from "./task/runner.js";
import { runTaskAgent } from "./task/agent.js";
import { initializeProject } from "./init.js";
import { compileSequence, loadTaskSequence } from "./task/sequence.js";
import { evaluateSafety } from "./task/safety.js";
import { rankByRisk } from "./task/risk.js";
import {
  createSupervisionController,
  type ApprovalHandler,
  type ApprovalRequest,
  type ApprovalResponse,
  type SupervisionMode,
} from "./task/supervision.js";
import { loadFeature, type Feature, type QAPlan } from "./feature/schema.js";
import { planFeature } from "./feature/planner.js";
import { runFeatureCampaign, type ApiScenarioExecution } from "./feature/runner.js";

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
    return false;
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

interface TaskRunOpts {
  repo: string;
  file: string;
  timeout?: number;
  json?: boolean;
  project?: string;
}

interface TaskMatrixOpts extends Omit<TaskRunOpts, "project"> {
  projects?: string;
}

interface TaskCatalogOpts {
  repo: string;
  dir?: string;
  json?: boolean;
}

interface TaskExploreOpts extends TaskRunOpts {
  model?: string;
  maxSteps?: number;
  subscription?: boolean;
  supervised?: boolean;
  approvalMode?: string;
  reviewer?: string;
}

interface FeatureTestOpts {
  repo: string;
  file: string;
  model?: string;
  maxSteps?: number;
  timeout?: number;
  subscription?: boolean;
  supervised?: boolean;
  approvalMode?: string;
  reviewer?: string;
  planOnly?: boolean;
  json?: boolean;
}

interface TaskCompileOpts {
  repo: string;
  file: string;
  sequence: string;
  output?: string;
}

async function taskCompileAction(opts: TaskCompileOpts): Promise<void> {
  const repoPath = path.resolve(opts.repo);
  const taskFile = path.isAbsolute(opts.file) ? opts.file : path.join(repoPath, opts.file);
  const sequenceFile = path.isAbsolute(opts.sequence) ? opts.sequence : path.join(repoPath, opts.sequence);
  const task = await loadTask(taskFile);
  const sequence = await loadTaskSequence(sequenceFile);
  if (sequence.taskId !== task.id) throw new Error(`Sequence taskId must match task ${task.id}.`);
  if (task.oracle === undefined)
    throw new Error("Task needs an explicit oracle before it can be compiled as trusted.");
  const violations = evaluateSafety(task, sequence);
  if (violations.length > 0) throw new Error(violations.map((item) => item.reason).join("\n"));
  const output = opts.output ?? `tests/qa-generated/${task.id}.spec.ts`;
  const outputFile = path.resolve(repoPath, output);
  const relative = path.relative(repoPath, outputFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Compiled spec must stay inside the repository.");
  }
  if (!outputFile.endsWith(".spec.ts"))
    throw new Error("Compiled spec must use the Playwright *.spec.ts suffix.");
  if (sequence.mutation === undefined) {
    throw new Error("Sequence needs a mutation object before it can be compiled into a trusted task.");
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  const compileOptions = {
    ...(task.target?.baseUrl === undefined ? {} : { baseUrl: task.target.baseUrl }),
    ...(task.target?.storageState === undefined ? {} : { storageState: task.target.storageState }),
    ...(task.oracleChecks === undefined ? {} : { oracleChecks: task.oracleChecks }),
    ...(task.safety?.maxRequests === undefined ? {} : { maxRequests: task.safety.maxRequests }),
  };
  await writeFile(outputFile, compileSequence(sequence, compileOptions), "utf8");
  const mutationFile = outputFile.replace(/\.spec\.ts$/, ".mutation.spec.ts");
  await writeFile(mutationFile, compileSequence(sequence, compileOptions, true), "utf8");
  console.log(`✔ compiled ${relative.split(path.sep).join("/")}`);
  console.log(`  mutation: ${path.relative(repoPath, mutationFile).split(path.sep).join("/")}`);
}

async function taskRunAction(opts: TaskRunOpts): Promise<void> {
  const repoPath = path.resolve(opts.repo);
  const taskFile = path.isAbsolute(opts.file) ? opts.file : path.join(repoPath, opts.file);
  const task = await loadTask(taskFile);
  const overrides: Partial<RunConfig> = {};
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const { config } = await buildConfig(repoPath, overrides);
  const result = await runTask({
    repoPath,
    task,
    runner: playwrightRunner(repoPath, config.commandTimeoutMs, opts.project),
    allowedWriteDirs: config.allowedWriteDirs,
    ...(opts.project === undefined ? {} : { executionProfile: opts.project }),
  });

  if (opts.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const marker = result.status === "passed" ? "✔" : result.status === "failed" ? "✘" : "⚠";
    console.log(`\n${marker} ${result.taskId}: ${result.status.toUpperCase()} (${result.classification})`);
    console.log(`   ${result.reason}`);
    console.log(`   attempts: ${result.attempts.length} · artifacts: ${result.artifactsDir}`);
  }

  // A blocked or inconclusive task is deliberately not green. Exit 2 lets CI
  // distinguish it from a reproducible behavioral failure (exit 1).
  if (result.status === "failed") process.exitCode = 1;
  if (result.status === "blocked" || result.status === "inconclusive") process.exitCode = 2;
}

async function taskMatrixAction(opts: TaskMatrixOpts): Promise<void> {
  const repoPath = path.resolve(opts.repo);
  const taskFile = path.isAbsolute(opts.file) ? opts.file : path.join(repoPath, opts.file);
  const task = await loadTask(taskFile);
  const projects =
    opts.projects
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ??
    task.execution?.projects ??
    [];
  if (projects.length === 0) {
    throw new Error("Task matrix needs --projects chromium,firefox,... or task.execution.projects.");
  }
  const overrides: Partial<RunConfig> = {};
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  const { config } = await buildConfig(repoPath, overrides);
  const results = [];
  for (const project of projects) {
    results.push(
      await runTask({
        repoPath,
        task,
        runner: playwrightRunner(repoPath, config.commandTimeoutMs, project),
        allowedWriteDirs: config.allowedWriteDirs,
        executionProfile: project,
      }),
    );
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.join(repoPath, ".qa-agent", "matrix-runs", `${stamp}-${task.id}`);
  await mkdir(artifactDir, { recursive: true });
  const summary = {
    schemaVersion: 1,
    taskId: task.id,
    projects,
    status: results.every((result) => result.status === "passed")
      ? "passed"
      : results.some((result) => result.status === "failed")
        ? "failed"
        : "inconclusive",
    results,
  };
  await writeFile(
    path.join(artifactDir, "matrix-result.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8",
  );
  const markdown = [
    `# QA matrix: ${task.id}`,
    "",
    `- **Business flow:** ${task.business?.flow ?? "unspecified"}`,
    `- **Projects:** ${projects.map((project) => `\`${project}\``).join(", ")}`,
    "",
    "## Results",
    "",
    ...results.map(
      (result) =>
        `- ${result.executionProfile}: **${result.status}** (${result.classification}) — ${result.reason}`,
    ),
    "",
  ].join("\n");
  await writeFile(path.join(artifactDir, "matrix-report.md"), markdown, "utf8");
  if (opts.json === true) console.log(JSON.stringify(summary, null, 2));
  else console.log(markdown + `artifacts: ${path.relative(repoPath, artifactDir).split(path.sep).join("/")}`);
  if (summary.status === "failed") process.exitCode = 1;
  if (summary.status === "inconclusive") process.exitCode = 2;
}

async function taskCatalogAction(opts: TaskCatalogOpts): Promise<void> {
  const repoPath = path.resolve(opts.repo);
  const taskDir = path.resolve(repoPath, opts.dir ?? "qa-tasks");
  const relative = path.relative(repoPath, taskDir);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Task catalog directory must stay inside the repository.");
  const entries = await readdir(taskDir, { recursive: true });
  const tasks = [];
  for (const entry of entries) {
    const name = String(entry);
    if (!name.endsWith(".json") || name.endsWith(".sequence.json")) continue;
    const file = path.join(taskDir, name);
    tasks.push({ file: path.relative(repoPath, file).split(path.sep).join("/"), task: await loadTask(file) });
  }
  const ranked = rankByRisk(tasks.map((entry) => ({ ...entry, risk: entry.task.risk }))).map(
    ({ item, score }) => ({ ...item, score }),
  );
  if (opts.json === true) {
    console.log(JSON.stringify(ranked, null, 2));
    return;
  }
  console.log("Risk-prioritized QA task catalog\n");
  for (const entry of ranked) {
    const flow = entry.task.business?.flow ?? "unspecified";
    const projects = entry.task.execution?.projects.join(", ") ?? "default";
    console.log(
      `${entry.score.toString().padStart(2, " ")}  ${entry.task.id}  [${flow}]  projects=${projects}`,
    );
    console.log(`    ${entry.task.goal} — ${entry.file}`);
  }
}

async function taskExploreAction(opts: TaskExploreOpts): Promise<void> {
  if (opts.subscription !== true && !process.env["ANTHROPIC_API_KEY"]) {
    console.error("Error: ANTHROPIC_API_KEY is not set. Export it, or use --subscription.");
    process.exitCode = 1;
    return;
  }
  const repoPath = path.resolve(opts.repo);
  const taskFile = path.isAbsolute(opts.file) ? opts.file : path.join(repoPath, opts.file);
  const loadedTask = await loadTask(taskFile);
  const supervisionModes: SupervisionMode[] = ["autonomous", "approve_risky", "approve_all"];
  if (opts.approvalMode !== undefined && !supervisionModes.includes(opts.approvalMode as SupervisionMode)) {
    throw new Error(`--approval-mode must be one of ${supervisionModes.join(", ")}.`);
  }
  const requestedMode =
    (opts.approvalMode as SupervisionMode | undefined) ??
    (opts.supervised === true ? "approve_risky" : loadedTask.supervision?.mode);
  const task: QATask =
    requestedMode === undefined
      ? loadedTask
      : {
          ...loadedTask,
          supervision: {
            mode: requestedMode,
            checkpointBeforePlan: loadedTask.supervision?.checkpointBeforePlan ?? true,
            checkpointBeforeExecution: loadedTask.supervision?.checkpointBeforeExecution ?? true,
            checkpointBeforeFinding: loadedTask.supervision?.checkpointBeforeFinding ?? true,
            ...((opts.reviewer ?? loadedTask.supervision?.reviewer) === undefined
              ? {}
              : { reviewer: opts.reviewer ?? loadedTask.supervision?.reviewer }),
          },
        };
  if (task.oracle === undefined) {
    console.error(
      "Error: task explore needs an explicit oracle; add oracle to the task JSON before exploring.",
    );
    process.exitCode = 2;
    return;
  }
  const overrides: Partial<RunConfig> = {};
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  if (opts.maxSteps !== undefined) overrides.maxSteps = opts.maxSteps;
  if (opts.model !== undefined) overrides.modelId = opts.model;
  const { config } = await buildConfig(repoPath, overrides);
  const model = opts.subscription === true ? claudeCliModel() : createAnthropicModel(config.modelId);
  const approvalHandler =
    task.supervision?.mode !== undefined && task.supervision.mode !== "autonomous" && opts.json !== true
      ? interactiveApprovalHandler(task.supervision.reviewer)
      : undefined;
  const result = await runTaskAgent({
    model,
    task,
    config,
    runner: playwrightRunner(repoPath, config.commandTimeoutMs),
    ...(opts.json === true ? {} : { onStep: renderStep }),
    ...(approvalHandler === undefined ? {} : { approvalHandler }),
  });

  if (opts.json === true) console.log(JSON.stringify(result, null, 2));
  else if (result.finished && result.verification) {
    console.log(
      `\n${result.verification.status.toUpperCase()} ${task.id} (${result.verification.classification})`,
    );
    console.log(`   final spec: ${result.finalSpec}`);
    if (result.mutation)
      console.log(`   mutation proof: ${result.mutation.spec} (${result.mutation.status})`);
    console.log(`   replay task: ${result.replayTaskFile}`);
    console.log(`   ${result.verification.reason}`);
    if (result.shrink && result.shrink.removedActionIds.length > 0) {
      console.log(`   minimized: removed ${result.shrink.removedActionIds.join(", ")}`);
    }
    if (result.findingReview) {
      console.log(
        `   human review: ${result.findingReview.outcome.toUpperCase()}${result.findingReview.reviewer ? ` by ${result.findingReview.reviewer}` : ""}`,
      );
    }
    if (result.approvalLogFile) console.log(`   approval log: ${result.approvalLogFile}`);
    console.log(`   artifacts: ${result.verification.artifactsDir}`);
  } else {
    console.log(
      `\n${result.paused === true ? "PAUSED" : "INCONCLUSIVE"} ${task.id}: ${result.stoppedReason ?? "No final verdict."}`,
    );
    if (result.approvalLogFile) console.log(`   approval log: ${result.approvalLogFile}`);
  }

  if (!result.finished) process.exitCode = 2;
  else if (result.verification?.status === "failed") process.exitCode = 1;
  else if (result.verification?.status !== "passed") process.exitCode = 2;
}

function interactiveApprovalHandler(reviewer?: string): ApprovalHandler {
  return async (request: ApprovalRequest): Promise<ApprovalResponse> => {
    console.log(`\n[SUPERVISION] ${request.summary}`);
    console.log(`  task: ${request.taskId} · kind: ${request.kind} · risk: ${request.risk}`);
    console.log(request.detail.replace(/^/gm, "  "));
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    try {
      while (true) {
        const answer = (await readline.question("Approve [a] once, approve [s]ession, [d]eny, or [p]ause? "))
          .trim()
          .toLowerCase();
        if (answer === "a") {
          return { outcome: "approve", scope: "once", ...(reviewer === undefined ? {} : { reviewer }) };
        }
        if (answer === "s") {
          return {
            outcome: "approve",
            scope: "session",
            ...(reviewer === undefined ? {} : { reviewer }),
          };
        }
        if (answer === "d" || answer === "p") {
          const note = (await readline.question("Reviewer note (optional): ")).trim();
          return {
            outcome: answer === "d" ? "deny" : "pause",
            scope: "once",
            ...(reviewer === undefined ? {} : { reviewer }),
            ...(note.length === 0 ? {} : { note }),
          };
        }
      }
    } finally {
      readline.close();
    }
  };
}

function renderFeaturePlan(plan: QAPlan): void {
  console.log(`\nQA plan: ${plan.summary}`);
  for (const scenario of plan.scenarios) {
    console.log(
      `  ${scenario.priority.toUpperCase()}  ${scenario.id}  [${scenario.technique}/${scenario.execution}]`,
    );
    console.log(`      ${scenario.title} · criteria: ${scenario.criterionIds.join(", ")}`);
    console.log(`      why: ${scenario.rationale}`);
  }
  if (plan.excluded.length > 0) {
    console.log("  excluded:");
    for (const item of plan.excluded) console.log(`      ${item.area}: ${item.reason}`);
  }
  if (plan.questions.length > 0) {
    console.log("  questions:");
    for (const question of plan.questions) {
      console.log(`      ${question.blocking ? "BLOCKING " : ""}${question.question}`);
    }
  }
}

async function featureTestAction(opts: FeatureTestOpts): Promise<void> {
  if (opts.subscription !== true && !process.env["ANTHROPIC_API_KEY"]) {
    console.error("Error: ANTHROPIC_API_KEY is not set. Export it, or use --subscription.");
    process.exitCode = 1;
    return;
  }
  const repoPath = path.resolve(opts.repo);
  const featureFile = path.isAbsolute(opts.file) ? opts.file : path.join(repoPath, opts.file);
  const loadedFeature = await loadFeature(featureFile);
  const supervisionModes: SupervisionMode[] = ["autonomous", "approve_risky", "approve_all"];
  if (opts.approvalMode !== undefined && !supervisionModes.includes(opts.approvalMode as SupervisionMode)) {
    throw new Error(`--approval-mode must be one of ${supervisionModes.join(", ")}.`);
  }
  const requestedMode =
    (opts.approvalMode as SupervisionMode | undefined) ??
    (opts.supervised === true ? "approve_risky" : loadedFeature.supervision?.mode);
  const reviewer = opts.reviewer ?? loadedFeature.supervision?.reviewer;
  const feature: Feature =
    requestedMode === undefined
      ? loadedFeature
      : {
          ...loadedFeature,
          supervision: {
            mode: requestedMode,
            checkpointBeforePlan: loadedFeature.supervision?.checkpointBeforePlan ?? true,
            checkpointBeforeExecution: loadedFeature.supervision?.checkpointBeforeExecution ?? true,
            checkpointBeforeFinding: loadedFeature.supervision?.checkpointBeforeFinding ?? true,
            ...(reviewer === undefined ? {} : { reviewer }),
          },
        };

  const overrides: Partial<RunConfig> = {};
  if (opts.timeout !== undefined) overrides.commandTimeoutMs = opts.timeout;
  if (opts.maxSteps !== undefined) overrides.maxSteps = opts.maxSteps;
  if (opts.model !== undefined) overrides.modelId = opts.model;
  const { config } = await buildConfig(repoPath, overrides);
  const plannerModel =
    opts.subscription === true ? claudeCliTextModel() : createAnthropicModel(config.modelId);
  const executionModel = opts.subscription === true ? claudeCliModel() : createAnthropicModel(config.modelId);
  const approvalHandler =
    feature.supervision?.mode !== undefined && feature.supervision.mode !== "autonomous" && opts.json !== true
      ? interactiveApprovalHandler(feature.supervision.reviewer)
      : undefined;
  const supervision =
    feature.supervision === undefined
      ? undefined
      : await createSupervisionController({
          repoPath,
          taskId: `feature-${feature.id}`,
          policy: feature.supervision,
          ...(approvalHandler === undefined ? {} : { handler: approvalHandler }),
        });

  const workDir = path.join(repoPath, ".qa-agent", "feature-work", feature.id);
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "feature.json"), JSON.stringify(feature, null, 2) + "\n", "utf8");

  let plan: QAPlan | undefined;
  let reviewerFeedback: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    plan = await planFeature({
      model: plannerModel,
      feature,
      ...(reviewerFeedback === undefined ? {} : { reviewerFeedback }),
    });
    await writeFile(path.join(workDir, "plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");
    if (opts.json !== true) renderFeaturePlan(plan);
    const decision = await supervision?.requestPlan(JSON.stringify(plan, null, 2));
    if (decision === undefined || decision.outcome === "approve") break;
    if (decision.outcome === "pause") {
      const paused = {
        schemaVersion: 1,
        featureId: feature.id,
        status: "paused",
        reason: `The QA plan is awaiting human approval (${decision.id}).`,
        plan,
        approvalLogFile:
          supervision === undefined
            ? undefined
            : path.relative(repoPath, supervision.auditFile).split(path.sep).join("/"),
      };
      console.log(opts.json === true ? JSON.stringify(paused, null, 2) : `\nPAUSED: ${paused.reason}`);
      process.exitCode = 2;
      return;
    }
    reviewerFeedback =
      decision.note ?? "The reviewer rejected the plan. Reduce risk or revise its scenarios.";
    plan = undefined;
  }
  if (plan === undefined) {
    console.error("The reviewer rejected three QA plans; the feature remains untested.");
    process.exitCode = 2;
    return;
  }

  if (opts.planOnly === true) {
    await supervision?.complete();
    if (opts.json === true) console.log(JSON.stringify(plan, null, 2));
    else console.log(`\nPlan approved and saved to ${path.relative(repoPath, workDir)}/plan.json`);
    return;
  }

  const apiConfig = feature.api;
  const runApi =
    apiConfig === undefined
      ? undefined
      : async (): Promise<ApiScenarioExecution> => {
          const url = apiConfig.url ?? feature.target?.baseUrl;
          if (url === undefined) {
            return {
              statusOverride: "needs_review",
              reason:
                "API coverage was planned, but neither feature.api.url nor target.baseUrl is configured.",
            };
          }
          const approval = await supervision?.requestExecution(
            JSON.stringify({ kind: "api_contract", ...apiConfig, url }, null, 2),
            "Execute the generated API contract campaign",
          );
          if (approval?.outcome === "pause") {
            return {
              statusOverride: "paused",
              reason: `API contract execution is awaiting approval (${approval.id}).`,
            };
          }
          if (approval?.outcome === "deny") {
            return {
              statusOverride: "needs_review",
              reason: `The reviewer denied API execution${approval.note ? `: ${approval.note}` : "."}`,
            };
          }
          const spec = path.isAbsolute(apiConfig.spec) ? apiConfig.spec : path.join(repoPath, apiConfig.spec);
          let contract;
          try {
            contract = await runContract(
              {
                spec,
                url,
                ...(apiConfig.checks === undefined ? {} : { checks: apiConfig.checks }),
                mode: apiConfig.mode,
                ...(apiConfig.maxExamples === undefined ? {} : { maxExamples: apiConfig.maxExamples }),
              },
              schemathesisRunner(repoPath, config.commandTimeoutMs),
            );
          } catch (error) {
            contract = {
              passed: false,
              exitCode: null,
              report: null,
              failures: [],
              output: String(error),
              inconclusive: true as const,
            };
          }
          if (!contract.passed && contract.inconclusive !== true) {
            const findingReview = await supervision?.requestFinding(
              JSON.stringify(
                {
                  kind: "api_contract_violation",
                  failures: contract.failures,
                  output: contract.output.slice(-4_000),
                },
                null,
                2,
              ),
            );
            if (findingReview?.outcome === "pause") {
              return {
                result: contract,
                findingReview,
                statusOverride: "paused",
                reason: `API violations are awaiting human review (${findingReview.id}).`,
              };
            }
            return {
              result: contract,
              ...(findingReview === undefined ? {} : { findingReview }),
            };
          }
          return { result: contract };
        };

  const result = await runFeatureCampaign({
    repoPath,
    feature,
    plan,
    runBrowser: async (task, projects) => {
      if (opts.json !== true) console.log(`\nRunning scenario: ${task.business?.capability ?? task.id}`);
      const agent = await runTaskAgent({
        model: executionModel,
        task,
        config,
        runner: playwrightRunner(repoPath, config.commandTimeoutMs),
        ...(opts.json === true ? {} : { onStep: renderStep }),
        ...(approvalHandler === undefined ? {} : { approvalHandler }),
      });
      if (agent.finished !== true || agent.verification?.status !== "passed" || projects.length === 0) {
        return { agent };
      }
      const replayTask = await loadTask(path.join(repoPath, agent.replayTaskFile));
      const matrix = [];
      for (const project of projects) {
        matrix.push(
          await runTask({
            repoPath,
            task: replayTask,
            runner: playwrightRunner(repoPath, config.commandTimeoutMs, project),
            allowedWriteDirs: config.allowedWriteDirs,
            executionProfile: project,
          }),
        );
      }
      return { agent, matrix };
    },
    ...(runApi === undefined ? {} : { runApi }),
  });

  if (result.status !== "paused") await supervision?.complete();
  if (opts.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n${result.status.toUpperCase()} ${feature.id}: ${result.reason}`);
    for (const scenario of result.scenarios) {
      console.log(`  ${scenario.status.padEnd(13)} ${scenario.scenario.id} · ${scenario.reason}`);
    }
    console.log(`  report: ${result.reportFile}`);
  }
  if (result.status === "failed") process.exitCode = 1;
  if (result.status !== "passed" && result.status !== "failed") process.exitCode = 2;
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
program.name("qa-agent").description("Task-driven exploratory QA with reproducible Playwright evidence.");

program
  .command("init")
  .description("Initialize a repository for task-driven exploratory QA")
  .requiredOption("-r, --repo <path>", "Path to the repository")
  .requiredOption("-u, --url <url>", "Local or staging target URL")
  .option("--start-command <command>", "Command that starts the local application")
  .option("--auth <path>", "Existing Playwright storageState file to copy locally")
  .action(async (opts: { repo: string; url: string; startCommand?: string; auth?: string }) => {
    const result = await initializeProject({
      repoPath: opts.repo,
      baseUrl: opts.url,
      ...(opts.startCommand === undefined ? {} : { startCommand: opts.startCommand }),
      ...(opts.auth === undefined ? {} : { authFile: opts.auth }),
    });
    console.log(`✔ initialized ${path.resolve(opts.repo)}`);
    console.log(`  config: ${result.configFile}`);
    console.log(`  first task: ${result.taskFile}`);
    if (result.authFile) console.log(`  auth: ${result.authFile}`);
  });

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

const featureCommand = program
  .command("feature")
  .description("Plan and execute risk-based QA campaigns for product features.");

featureCommand
  .command("test")
  .description("Test one feature as a supervised QA would: plan, explore, verify, and report")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .requiredOption("-f, --file <path>", "Feature JSON file (repo-relative or absolute)")
  .option("-m, --model <id>", "Anthropic model id")
  .option("--max-steps <n>", "Maximum agent iterations per browser scenario", (v) => Number.parseInt(v, 10))
  .option("--timeout <ms>", "Per-command and test timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--subscription", "Use the Claude Code CLI instead of ANTHROPIC_API_KEY")
  .option("--supervised", "Require QA approval for the plan, risky execution, and findings")
  .option("--approval-mode <mode>", "Supervision policy: autonomous | approve_risky | approve_all")
  .option("--reviewer <name>", "Reviewer identity written to approval logs")
  .option("--plan-only", "Generate, validate, and approve the QA plan without executing it")
  .option("--json", "Emit the structured campaign result")
  .action(featureTestAction);

const taskCommand = program.command("task").description("Run isolated, reproducible QA tasks.");

taskCommand
  .command("run")
  .description("Execute a task contract and save an isolated run workspace")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .requiredOption("-f, --file <path>", "Task JSON file (repo-relative or absolute)")
  .option("--timeout <ms>", "Per-attempt timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--json", "Emit the structured task result")
  .option("--project <name>", "Playwright project to execute (for one browser/device profile)")
  .action(taskRunAction);

taskCommand
  .command("matrix")
  .description("Run one task across configured Playwright browser/device projects")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .requiredOption("-f, --file <path>", "Task JSON file")
  .option(
    "--projects <list>",
    "Comma-separated Playwright project names (defaults to task.execution.projects)",
  )
  .option("--timeout <ms>", "Per-attempt timeout in ms", (v) => Number.parseInt(v, 10))
  .option("--json", "Emit the structured matrix result")
  .action(taskMatrixAction);

taskCommand
  .command("catalog")
  .description("List business QA tasks ordered by impact × probability")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .option("-d, --dir <path>", "Task directory (default: qa-tasks)")
  .option("--json", "Emit the ranked task catalog as JSON")
  .action(taskCatalogAction);

function addTaskExploreOptions(command: Command): Command {
  return command
    .requiredOption("-r, --repo <path>", "Path to the repo under test")
    .requiredOption("-f, --file <path>", "Task JSON file (repo-relative or absolute)")
    .option("-m, --model <id>", "Anthropic model id")
    .option("--max-steps <n>", "Maximum agent iterations", (v) => Number.parseInt(v, 10))
    .option("--timeout <ms>", "Per-command timeout in ms", (v) => Number.parseInt(v, 10))
    .option("--subscription", "Use the Claude Code CLI instead of ANTHROPIC_API_KEY")
    .option("--supervised", "Require approval for risky commands, browser execution, and findings")
    .option("--approval-mode <mode>", "Supervision policy: autonomous | approve_risky | approve_all")
    .option("--reviewer <name>", "Reviewer identity written to the approval log")
    .option("--json", "Emit the structured agent result")
    .action(taskExploreAction);
}

addTaskExploreOptions(
  taskCommand
    .command("explore")
    .description("Explore one task, author a final Playwright spec, and verify it independently"),
);

addTaskExploreOptions(
  taskCommand
    .command("resume")
    .description("Resume a paused supervised task using its persistent approval session"),
);

taskCommand
  .command("compile")
  .description("Compile a reviewed semantic sequence into normal and mutation Playwright specs")
  .requiredOption("-r, --repo <path>", "Path to the repo under test")
  .requiredOption("-f, --file <path>", "Task JSON file")
  .requiredOption("-s, --sequence <path>", "Semantic sequence JSON file")
  .option("-o, --output <path>", "Repo-relative output spec")
  .action(taskCompileAction);

program.parseAsync().catch((err: unknown) => {
  // Expected failures (bad config, missing ticket, …) get a clean message; only
  // truly unexpected errors show a stack, and only when DEBUG is set.
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env["DEBUG"] && err instanceof Error) console.error(err.stack);
  process.exitCode = 1;
});
