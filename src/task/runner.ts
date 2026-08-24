import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeEvidence, TestRunner, TestRunResult } from "../verify.js";
import { resolveTaskSpec, type QATask } from "./schema.js";
import { classifyFinding, type FindingClassification } from "./finding.js";
import { renderTaskReport } from "./report.js";
import { isGitRepo, listChangedPaths, revertDisallowedChanges } from "../workspace.js";

export type TaskStatus = "passed" | "failed" | "blocked" | "inconclusive";

export interface TaskAttempt {
  index: number;
  passed: boolean;
  inconclusive: boolean;
  exitCode: number | null;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  outputFile: string;
  evidence?: RuntimeEvidence;
  revertedPaths: string[];
}

export interface TaskRunResult {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  goal: string;
  status: TaskStatus;
  classification: FindingClassification;
  reason: string;
  startedAt: string;
  finishedAt: string;
  spec: string;
  executionProfile?: string;
  attempts: TaskAttempt[];
  mutation?: TaskMutationProof;
  artifactsDir: string;
  reportFile: string;
}

export interface TaskMutationProof {
  spec: string;
  attempts: TaskAttempt[];
  status: "meaningful" | "not_meaningful" | "inconclusive";
  reason: string;
}

export interface TaskClock {
  now(): Date;
}

const systemClock: TaskClock = { now: () => new Date() };

function safeStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function classifyTaskRuns(
  runs: TestRunResult[],
  requiredEvidence: Array<"ui" | "network" | "console" | "screenshot"> = [],
): Pick<TaskRunResult, "status" | "reason"> {
  if (runs.some((run) => run.inconclusive === true)) {
    return { status: "inconclusive", reason: "At least one attempt could not execute reliably." };
  }
  for (const channel of requiredEvidence) {
    const missing = runs.some(
      (run) =>
        run.evidence === undefined ||
        !run.evidence.channels.includes(channel) ||
        (channel === "ui" && !run.evidence.oracleReached),
    );
    if (missing) {
      return {
        status: "inconclusive",
        reason: `Required ${channel} evidence was not captured in every attempt.`,
      };
    }
  }
  const passes = runs.filter((run) => run.passed).length;
  if (passes === runs.length) {
    return { status: "passed", reason: `The task passed ${passes}/${runs.length} clean attempts.` };
  }
  if (passes === 0) {
    return { status: "failed", reason: `The task failed ${runs.length}/${runs.length} clean attempts.` };
  }
  return {
    status: "inconclusive",
    reason: `The result was inconsistent (${passes}/${runs.length} attempts passed); treat it as flaky, not as a pass.`,
  };
}

export async function runTask(args: {
  repoPath: string;
  task: QATask;
  runner: TestRunner;
  clock?: TaskClock;
  allowedWriteDirs?: string[];
  executionProfile?: string;
}): Promise<TaskRunResult> {
  const { repoPath, task, runner, clock = systemClock } = args;
  const allowedWriteDirs = [...new Set([...(args.allowedWriteDirs ?? ["tests", "reports"]), ".qa-agent"])];
  const gitBacked = await isGitRepo(repoPath);
  const preexistingDirty: ReadonlySet<string> = gitBacked
    ? new Set(await listChangedPaths(repoPath))
    : new Set();
  const started = clock.now();
  const runId = `${safeStamp(started)}-${task.id}`;
  const artifactsDir = path.join(repoPath, ".qa-agent", "task-runs", runId);
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(artifactsDir, "task.json"), JSON.stringify(task, null, 2) + "\n", "utf8");

  if (task.spec === undefined) {
    throw new Error(`Task ${task.id} has no spec. Use task explore to author one first.`);
  }
  const spec = resolveTaskSpec(repoPath, task.spec);
  const runs: TestRunResult[] = [];
  const attempts: TaskAttempt[] = [];

  if (task.blockedReason === undefined) {
    for (let index = 1; index <= task.attempts; index++) {
      const attemptStarted = process.hrtime.bigint();
      let run: TestRunResult;
      try {
        run = await runner(spec);
      } catch (error) {
        run = {
          passed: false,
          exitCode: null,
          passedCount: 0,
          failedCount: 0,
          output: error instanceof Error ? (error.stack ?? error.message) : String(error),
          inconclusive: true,
        };
      }
      const revertedPaths = gitBacked
        ? await revertDisallowedChanges(repoPath, allowedWriteDirs, preexistingDirty)
        : [];
      const durationMs = Number(process.hrtime.bigint() - attemptStarted) / 1e6;
      runs.push(run);
      const outputFile = `attempt-${index}.log`;
      await writeFile(path.join(artifactsDir, outputFile), run.output, "utf8");
      attempts.push({
        index,
        passed: run.passed,
        inconclusive: run.inconclusive === true,
        exitCode: run.exitCode,
        passedCount: run.passedCount,
        failedCount: run.failedCount,
        durationMs,
        outputFile,
        revertedPaths,
        ...(run.evidence === undefined ? {} : { evidence: run.evidence }),
      });
    }
  }

  let verdict =
    task.blockedReason !== undefined
      ? { status: "blocked" as const, reason: task.blockedReason }
      : classifyTaskRuns(runs, task.evidence?.required);
  let mutation: TaskMutationProof | undefined;
  if (verdict.status === "passed" && task.oracle === undefined) {
    verdict = {
      status: "inconclusive",
      reason: "No explicit oracle was supplied, so a passing run cannot be verified.",
    };
  } else if (verdict.status === "passed" && task.mutationSpec === undefined) {
    verdict = {
      status: "inconclusive",
      reason: "No mutationSpec was supplied, so the passing oracle has no behavior-change proof.",
    };
  }
  if (verdict.status === "passed" && task.mutationSpec !== undefined) {
    const mutationSpec = resolveTaskSpec(repoPath, task.mutationSpec);
    const mutationRuns: TestRunResult[] = [];
    const mutationAttempts: TaskAttempt[] = [];
    for (let index = 1; index <= task.attempts; index++) {
      const attemptStarted = process.hrtime.bigint();
      let run: TestRunResult;
      try {
        run = await runner(mutationSpec);
      } catch (error) {
        run = {
          passed: false,
          exitCode: null,
          passedCount: 0,
          failedCount: 0,
          output: error instanceof Error ? (error.stack ?? error.message) : String(error),
          inconclusive: true,
        };
      }
      const revertedPaths = gitBacked
        ? await revertDisallowedChanges(repoPath, allowedWriteDirs, preexistingDirty)
        : [];
      const durationMs = Number(process.hrtime.bigint() - attemptStarted) / 1e6;
      mutationRuns.push(run);
      const outputFile = `mutation-attempt-${index}.log`;
      await writeFile(path.join(artifactsDir, outputFile), run.output, "utf8");
      mutationAttempts.push({
        index,
        passed: run.passed,
        inconclusive: run.inconclusive === true,
        exitCode: run.exitCode,
        passedCount: run.passedCount,
        failedCount: run.failedCount,
        durationMs,
        outputFile,
        revertedPaths,
        ...(run.evidence === undefined ? {} : { evidence: run.evidence }),
      });
    }
    const relativeSpec = path.relative(repoPath, mutationSpec).split(path.sep).join("/");
    if (mutationRuns.some((run) => run.inconclusive === true)) {
      mutation = {
        spec: relativeSpec,
        attempts: mutationAttempts,
        status: "inconclusive",
        reason: "The mutation proof could not execute reliably.",
      };
      verdict = { status: "inconclusive", reason: mutation.reason };
    } else if (mutationRuns.some((run) => run.passed)) {
      mutation = {
        spec: relativeSpec,
        attempts: mutationAttempts,
        status: "not_meaningful",
        reason: "The mutated behavior still passed the original oracle.",
      };
      verdict = { status: "inconclusive", reason: mutation.reason };
    } else {
      mutation = {
        spec: relativeSpec,
        attempts: mutationAttempts,
        status: "meaningful",
        reason: `The mutation spec failed ${mutationRuns.length}/${mutationRuns.length} clean attempts.`,
      };
    }
  }
  const reportFile = "report.md";
  const result: TaskRunResult = {
    schemaVersion: 1,
    runId,
    taskId: task.id,
    goal: task.goal,
    ...verdict,
    classification: classifyFinding(task, verdict.status, verdict.reason),
    startedAt: started.toISOString(),
    finishedAt: clock.now().toISOString(),
    spec: path.relative(repoPath, spec).split(path.sep).join("/"),
    ...(args.executionProfile === undefined ? {} : { executionProfile: args.executionProfile }),
    attempts,
    ...(mutation === undefined ? {} : { mutation }),
    artifactsDir: path.relative(repoPath, artifactsDir).split(path.sep).join("/"),
    reportFile,
  };
  await writeFile(path.join(artifactsDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  await writeFile(path.join(artifactsDir, reportFile), renderTaskReport(task, result), "utf8");
  return result;
}
