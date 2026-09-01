import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContractRunResult } from "../api/schemathesis.js";
import type { TaskAgentResult } from "../task/agent.js";
import type { TaskRunResult } from "../task/runner.js";
import type { QATask } from "../task/schema.js";
import type { ApprovalDecision } from "../task/supervision.js";
import type { Feature, QAPlan, QAScenario } from "./schema.js";

export type FeatureScenarioStatus = "passed" | "failed" | "inconclusive" | "paused" | "needs_review";
export type FeatureCampaignStatus = FeatureScenarioStatus;

export interface BrowserScenarioExecution {
  agent: TaskAgentResult;
  matrix?: TaskRunResult[];
}

export interface ApiScenarioExecution {
  result?: ContractRunResult;
  findingReview?: ApprovalDecision;
  statusOverride?: "paused" | "needs_review";
  reason?: string;
}

export interface FeatureScenarioResult {
  scenario: QAScenario;
  status: FeatureScenarioStatus;
  reason: string;
  taskId?: string;
  agent?: TaskAgentResult;
  matrix?: TaskRunResult[];
  contract?: ContractRunResult;
  findingReview?: ApprovalDecision;
}

export interface FeatureCampaignResult {
  schemaVersion: 1;
  featureId: string;
  status: FeatureCampaignStatus;
  reason: string;
  startedAt: string;
  finishedAt: string;
  plan: QAPlan;
  scenarios: FeatureScenarioResult[];
  artifactsDir: string;
  planFile: string;
  reportFile: string;
}

export interface FeatureClock {
  now(): Date;
}

const systemClock: FeatureClock = { now: () => new Date() };

function taskId(featureId: string, scenarioId: string): string {
  const combined = `${featureId}-${scenarioId}`;
  if (combined.length <= 80) return combined;
  const hash = createHash("sha256").update(combined).digest("hex").slice(0, 12);
  return `${combined.slice(0, 67)}-${hash}`;
}

function businessFlow(scenario: QAScenario): NonNullable<QATask["business"]>["flow"] {
  if (scenario.technique === "authorization" || scenario.technique === "security") {
    return "authorization";
  }
  if (scenario.technique === "regression") return "regression";
  if (scenario.technique === "negative" || scenario.technique === "boundary") return "error_handling";
  return "custom";
}

export function toScenarioTask(feature: Feature, scenario: QAScenario): QATask {
  const criterionChecks = feature.acceptanceCriteria
    .filter((criterion) => scenario.criterionIds.includes(criterion.id))
    .flatMap((criterion) => criterion.oracleChecks ?? []);
  return {
    version: 1,
    id: taskId(feature.id, scenario.id),
    goal: scenario.goal,
    oracle: scenario.oracle,
    attempts: feature.attempts,
    business: {
      flow: businessFlow(scenario),
      capability: scenario.title,
      tags: [scenario.technique, scenario.priority, ...scenario.criterionIds],
    },
    evidence: { required: scenario.evidence },
    ...(criterionChecks.length === 0 ? {} : { oracleChecks: criterionChecks }),
    ...(feature.target === undefined ? {} : { target: feature.target }),
    ...(feature.risk === undefined ? {} : { risk: feature.risk }),
    ...(feature.safety === undefined ? {} : { safety: feature.safety }),
    ...(feature.coverage.matrix.length === 0 ? {} : { execution: { projects: feature.coverage.matrix } }),
    ...(feature.supervision === undefined ? {} : { supervision: feature.supervision }),
  };
}

function browserResult(
  scenario: QAScenario,
  task: QATask,
  execution: BrowserScenarioExecution,
): FeatureScenarioResult {
  const { agent, matrix } = execution;
  if (!agent.finished) {
    return {
      scenario,
      taskId: task.id,
      status: agent.paused === true ? "paused" : "inconclusive",
      reason: agent.stoppedReason ?? "The exploratory agent did not produce a final verdict.",
      agent,
      ...(matrix === undefined ? {} : { matrix }),
    };
  }
  const verification = agent.verification;
  if (verification === undefined) {
    return {
      scenario,
      taskId: task.id,
      status: "inconclusive",
      reason: "The exploratory agent finished without independent verification.",
      agent,
      ...(matrix === undefined ? {} : { matrix }),
    };
  }
  if (verification.status === "failed") {
    const rejected = agent.findingReview?.outcome === "deny";
    return {
      scenario,
      taskId: task.id,
      status: rejected ? "needs_review" : "failed",
      reason: rejected
        ? `The technical failure was rejected by the reviewer: ${agent.findingReview?.note ?? "review the oracle and expected behavior"}.`
        : verification.reason,
      agent,
      ...(matrix === undefined ? {} : { matrix }),
    };
  }
  if (verification.status !== "passed") {
    return {
      scenario,
      taskId: task.id,
      status: "inconclusive",
      reason: verification.reason,
      agent,
      ...(matrix === undefined ? {} : { matrix }),
    };
  }

  if (matrix !== undefined && matrix.length > 0) {
    if (matrix.some((result) => result.status === "failed")) {
      return {
        scenario,
        taskId: task.id,
        status: "failed",
        reason: "At least one matrix profile failed.",
        agent,
        matrix,
      };
    }
    if (matrix.some((result) => result.status !== "passed")) {
      return {
        scenario,
        taskId: task.id,
        status: "inconclusive",
        reason: "At least one matrix profile was blocked or inconclusive.",
        agent,
        matrix,
      };
    }
  }
  return {
    scenario,
    taskId: task.id,
    status: "passed",
    reason: verification.reason,
    agent,
    ...(matrix === undefined ? {} : { matrix }),
  };
}

function apiResult(scenario: QAScenario, execution: ApiScenarioExecution): FeatureScenarioResult {
  if (execution.statusOverride !== undefined) {
    return {
      scenario,
      status: execution.statusOverride,
      reason: execution.reason ?? "API contract execution requires human review.",
      ...(execution.result === undefined ? {} : { contract: execution.result }),
      ...(execution.findingReview === undefined ? {} : { findingReview: execution.findingReview }),
    };
  }
  const result = execution.result;
  if (result === undefined || result.inconclusive === true) {
    return {
      scenario,
      status: "inconclusive",
      reason: execution.reason ?? "The API contract runner could not produce a meaningful result.",
      ...(result === undefined ? {} : { contract: result }),
    };
  }
  if (!result.passed) {
    const rejected = execution.findingReview?.outcome === "deny";
    return {
      scenario,
      status: rejected ? "needs_review" : "failed",
      reason: rejected
        ? `The API violation was rejected by the reviewer: ${execution.findingReview?.note ?? "review the contract"}.`
        : `${result.failures.length} API contract violation(s) found.`,
      contract: result,
      ...(execution.findingReview === undefined ? {} : { findingReview: execution.findingReview }),
    };
  }
  return { scenario, status: "passed", reason: "The API upheld its contract.", contract: result };
}

function campaignStatus(results: FeatureScenarioResult[]): Pick<FeatureCampaignResult, "status" | "reason"> {
  if (results.some((result) => result.status === "paused")) {
    return { status: "paused", reason: "The campaign paused at a human supervision checkpoint." };
  }
  if (results.some((result) => result.status === "failed")) {
    return { status: "failed", reason: "At least one scenario produced an accepted reproducible failure." };
  }
  if (results.some((result) => result.status === "inconclusive")) {
    return {
      status: "inconclusive",
      reason: "At least one scenario could not produce trustworthy evidence.",
    };
  }
  if (results.some((result) => result.status === "needs_review")) {
    return { status: "needs_review", reason: "At least one scenario needs product or oracle review." };
  }
  return { status: "passed", reason: "Every planned automated scenario passed its trust gates." };
}

function renderReport(feature: Feature, result: FeatureCampaignResult): string {
  const lines = [
    `# Feature QA report: ${feature.id}`,
    "",
    `- **Status:** ${result.status}`,
    `- **Goal:** ${feature.goal}`,
    `- **Reason:** ${result.reason}`,
    `- **Started:** ${result.startedAt}`,
    `- **Finished:** ${result.finishedAt}`,
    "",
    "## Scenario results",
    "",
    ...result.scenarios.flatMap((entry) => [
      `### ${entry.scenario.priority.toUpperCase()} · ${entry.scenario.title}`,
      "",
      `- **Status:** ${entry.status}`,
      `- **Technique:** ${entry.scenario.technique}`,
      `- **Criteria:** ${entry.scenario.criterionIds.join(", ")}`,
      `- **Reason:** ${entry.reason}`,
      ...(entry.agent?.verification?.artifactsDir === undefined
        ? []
        : [`- **Evidence:** ${entry.agent.verification.artifactsDir}`]),
      "",
    ]),
    "## Acceptance criteria coverage",
    "",
    ...feature.acceptanceCriteria.map((criterion) => {
      const entries = result.scenarios.filter((entry) => entry.scenario.criterionIds.includes(criterion.id));
      return `- **${criterion.id}:** ${criterion.text} — ${entries.map((entry) => `${entry.scenario.id} (${entry.status})`).join(", ")}`;
    }),
    "",
    "## Open questions",
    "",
    ...(result.plan.questions.length === 0
      ? ["- None."]
      : result.plan.questions.map(
          (question) =>
            `- **${question.id}${question.blocking ? " (blocking)" : ""}:** ${question.question} — ${question.reason}`,
        )),
    "",
    "## Explicitly excluded",
    "",
    ...(result.plan.excluded.length === 0
      ? ["- None."]
      : result.plan.excluded.map((item) => `- **${item.area}:** ${item.reason}`)),
    "",
  ];
  return lines.join("\n");
}

export async function runFeatureCampaign(args: {
  repoPath: string;
  feature: Feature;
  plan: QAPlan;
  runBrowser: (task: QATask, projects: string[]) => Promise<BrowserScenarioExecution>;
  runApi?: () => Promise<ApiScenarioExecution>;
  clock?: FeatureClock;
}): Promise<FeatureCampaignResult> {
  const clock = args.clock ?? systemClock;
  const startedAt = clock.now().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const artifactsAbs = path.join(args.repoPath, ".qa-agent", "feature-runs", `${stamp}-${args.feature.id}`);
  await mkdir(artifactsAbs, { recursive: true });
  const planAbs = path.join(artifactsAbs, "plan.json");
  const reportAbs = path.join(artifactsAbs, "report.md");
  await writeFile(
    path.join(artifactsAbs, "feature.json"),
    JSON.stringify(args.feature, null, 2) + "\n",
    "utf8",
  );
  await writeFile(planAbs, JSON.stringify(args.plan, null, 2) + "\n", "utf8");

  const scenarios: FeatureScenarioResult[] = [];
  let apiExecution: Promise<ApiScenarioExecution> | undefined;
  const priorityOrder = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;
  const orderedScenarios = [...args.plan.scenarios].sort(
    (left, right) => priorityOrder[left.priority] - priorityOrder[right.priority],
  );
  for (const scenario of orderedScenarios) {
    let result: FeatureScenarioResult;
    if (scenario.execution === "manual_review") {
      result = {
        scenario,
        status: "needs_review",
        reason: "The planner marked this scenario for manual product or oracle review.",
      };
    } else if (scenario.execution === "api_contract") {
      if (args.runApi === undefined) {
        result = {
          scenario,
          status: "inconclusive",
          reason: "The plan requires API contract testing, but no API runner is configured.",
        };
      } else {
        apiExecution ??= args.runApi();
        result = apiResult(scenario, await apiExecution);
      }
    } else {
      const task = toScenarioTask(args.feature, scenario);
      result = browserResult(scenario, task, await args.runBrowser(task, args.feature.coverage.matrix));
    }
    scenarios.push(result);
    if (result.status === "paused") break;
  }

  const verdict = campaignStatus(scenarios);
  const finishedAt = clock.now().toISOString();
  const relative = (file: string): string => path.relative(args.repoPath, file).split(path.sep).join("/");
  const result: FeatureCampaignResult = {
    schemaVersion: 1,
    featureId: args.feature.id,
    ...verdict,
    startedAt,
    finishedAt,
    plan: args.plan,
    scenarios,
    artifactsDir: relative(artifactsAbs),
    planFile: relative(planAbs),
    reportFile: relative(reportAbs),
  };
  await writeFile(path.join(artifactsAbs, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  await writeFile(reportAbs, renderReport(args.feature, result), "utf8");
  return result;
}
