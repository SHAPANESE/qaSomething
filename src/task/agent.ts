import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunConfig } from "../config.js";
import type { Model } from "../model.js";
import { parseAction } from "../parse.js";
import { runCommand } from "../shell.js";
import type { Message, Step } from "../types.js";
import type { TestRunner } from "../verify.js";
import { isGitRepo, listChangedPaths, revertDisallowedChanges } from "../workspace.js";
import { runTask, type TaskRunResult } from "./runner.js";
import type { QATask } from "./schema.js";
import { compileSequence, loadTaskSequence, type TaskSequence } from "./sequence.js";
import { shrinkSequence, type ShrinkResult } from "./shrinker.js";
import { evaluateSafety } from "./safety.js";

export interface TaskAgentResult {
  finished: boolean;
  finalSpec: string;
  steps: Step[];
  verification?: TaskRunResult;
  shrink?: ShrinkResult;
  stoppedReason?: string;
  workspaceDir: string;
}

function taskSystemPrompt(config: RunConfig): string {
  return `You are a focused exploratory QA coding agent. You receive ONE QA task and work like a Webwright-style coding agent: write Playwright code, execute it, inspect its output, and refine it.

Protocol: emit exactly one fenced bash block per turn, or one fenced done block. Commands run from the repository root.

Rules:
- Application source is read-only. Write only under ${config.allowedWriteDirs.join(", ")}.
- Use Playwright code as your browser action. Probes are disposable; the final artifact is a deterministic Playwright test.
- Observe behavior through assertions, network, console, DOM, and screenshots where useful.
- Use semantic locators and Playwright auto-waiting; never use arbitrary sleeps.
- Do not invent expected behavior. Use the task oracle when present; otherwise only assert objective consistency.
- A finding must be reproducible. A failing final test is valid when it expresses a clear oracle violation.
- Never claim completion until the required final spec exists. The harness will run it independently after your done signal.
- Never perform payments, invitations, external messages, account deletion, or destructive administration unless explicitly authorized by the task.`;
}

function taskPrompt(task: QATask, repoPath: string, finalSpec: string, workspaceDir: string): string {
  const target = task.target?.baseUrl ?? "Read the repository configuration to find the local target.";
  return `TASK ${task.id}
Goal: ${task.goal}
Oracle: ${task.oracle ?? "No explicit oracle. Restrict conclusions to objective technical or consistency failures."}
Target: ${target}
Actor: ${task.target?.actor ?? "default"}
Repository: ${repoPath}

Write exploratory probes under ${workspaceDir}/. Before finishing, write ${workspaceDir}/sequence.json with this shape:
{"version":1,"taskId":"${task.id}","title":"...","actions":[{"id":"navigate","intent":"...","code":"await page.goto(...)","required":true,"risk":"read"}],"assertion":{"intent":"...","code":"await expect(...)"}}
Use one semantic user action per entry and classify its risk. Mark only indispensable setup as required. The harness enforces the safety policy, compiles this sequence into ${finalSpec}, verifies it, and minimizes it when it fails. Begin by orienting yourself and inspecting the app/test configuration.`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function failureFingerprint(result: { errorText?: string; output: string }): string {
  return (result.errorText ?? result.output)
    .replace(/\d+(?:\.\d+)?(?:ms|s)\b/g, "<time>")
    .replace(/\\/g, "/")
    .trim()
    .slice(0, 1_000);
}

function sameFailure(
  baseline: { errorText?: string; output: string },
  candidate: { errorText?: string; output: string },
): boolean {
  const expected = failureFingerprint(baseline);
  const actual = failureFingerprint(candidate);
  return expected.length > 0 && actual === expected;
}

export async function runTaskAgent(args: {
  model: Model;
  task: QATask;
  config: RunConfig;
  runner: TestRunner;
  onStep?: (step: Step) => void;
}): Promise<TaskAgentResult> {
  const { model, task, config, runner, onStep } = args;
  const finalSpec = `tests/qa-generated/${task.id}.spec.ts`;
  const finalSpecAbs = path.join(config.repoPath, finalSpec);
  const workspaceDir = `.qa-agent/task-work/${task.id}`;
  const workspaceAbs = path.join(config.repoPath, workspaceDir);
  const sequenceFile = path.join(workspaceAbs, "sequence.json");
  await mkdir(workspaceAbs, { recursive: true });
  await writeFile(path.join(workspaceAbs, "task.json"), JSON.stringify(task, null, 2) + "\n", "utf8");

  const messages: Message[] = [
    { role: "user", content: taskPrompt(task, config.repoPath, finalSpec, workspaceDir) },
  ];
  const steps: Step[] = [];
  const gitBacked = await isGitRepo(config.repoPath);
  const preexistingDirty: ReadonlySet<string> = gitBacked
    ? new Set(await listChangedPaths(config.repoPath))
    : new Set();

  for (let index = 0; index < config.maxSteps; index++) {
    const assistant = await model.generate(taskSystemPrompt(config), messages);
    messages.push({ role: "assistant", content: assistant });
    const action = parseAction(assistant);

    if (action.kind === "finish") {
      const step: Step = { index, assistant, action };
      steps.push(step);
      onStep?.(step);
      if (!(await exists(sequenceFile))) {
        messages.push({
          role: "user",
          content: `[COMPLETION GATE] ${workspaceDir}/sequence.json does not exist. Continue working and describe the final semantic sequence before finishing.`,
        });
        continue;
      }

      let sequence: TaskSequence;
      try {
        sequence = await loadTaskSequence(sequenceFile);
        if (sequence.taskId !== task.id) {
          throw new Error(`sequence taskId ${sequence.taskId} does not match ${task.id}`);
        }
      } catch (error) {
        messages.push({
          role: "user",
          content: `[COMPLETION GATE] Invalid sequence.json: ${String(error)}. Repair it and continue.`,
        });
        continue;
      }
      const safetyViolations = evaluateSafety(task, sequence);
      if (safetyViolations.length > 0) {
        messages.push({
          role: "user",
          content: `[SAFETY GATE] Sequence blocked:\n${safetyViolations.map((item) => `- ${item.reason}`).join("\n")}\nRemove the actions or obtain an explicit task allowlist; do not execute them.`,
        });
        continue;
      }
      await mkdir(path.dirname(finalSpecAbs), { recursive: true });
      const compileOptions = {
        ...(task.target?.baseUrl === undefined ? {} : { baseUrl: task.target.baseUrl }),
        ...(task.target?.storageState === undefined ? {} : { storageState: task.target.storageState }),
      };
      await writeFile(finalSpecAbs, compileSequence(sequence, compileOptions), "utf8");
      const verificationTask: QATask = {
        ...task,
        spec: finalSpec,
        evidence: task.evidence ?? { required: ["ui", "screenshot"] },
      };

      const verificationRuns: Awaited<ReturnType<TestRunner>>[] = [];
      let verification = await runTask({
        repoPath: config.repoPath,
        task: verificationTask,
        allowedWriteDirs: config.allowedWriteDirs,
        runner: async (spec) => {
          const result = await runner(spec);
          verificationRuns.push(result);
          return result;
        },
      });
      if (verification.status === "inconclusive") {
        messages.push({
          role: "user",
          content: `[COMPLETION GATE] Independent verification was inconclusive: ${verification.reason}. Inspect ${verification.artifactsDir} and repair the final spec or environment.`,
        });
        continue;
      }
      let shrink: ShrinkResult | undefined;
      if (verification.status === "failed" && sequence.actions.length > 1) {
        const baseline = verificationRuns.find((run) => !run.passed && run.inconclusive !== true);
        if (baseline !== undefined) {
          shrink = await shrinkSequence(sequence, async (candidate) => {
            await writeFile(finalSpecAbs, compileSequence(candidate, compileOptions), "utf8");
            const result = await runner(finalSpecAbs);
            return !result.passed && result.inconclusive !== true && sameFailure(baseline, result);
          });
          await writeFile(
            path.join(workspaceAbs, "sequence.min.json"),
            JSON.stringify(shrink.sequence, null, 2) + "\n",
            "utf8",
          );
          await writeFile(finalSpecAbs, compileSequence(shrink.sequence, compileOptions), "utf8");
          if (shrink.removedActionIds.length > 0) {
            verification = await runTask({
              repoPath: config.repoPath,
              task: verificationTask,
              allowedWriteDirs: config.allowedWriteDirs,
              runner,
            });
            if (verification.status !== "failed") {
              messages.push({
                role: "user",
                content: `[COMPLETION GATE] The minimized sequence did not preserve a consistent failure. Repair sequence.json and continue.`,
              });
              continue;
            }
          }
        }
      }
      await writeFile(
        path.join(workspaceAbs, "trajectory.json"),
        JSON.stringify(steps, null, 2) + "\n",
        "utf8",
      );
      return {
        finished: true,
        finalSpec,
        steps,
        verification,
        ...(shrink === undefined ? {} : { shrink }),
        workspaceDir,
      };
    }

    if (action.kind === "none") {
      const step: Step = { index, assistant, action };
      steps.push(step);
      onStep?.(step);
      messages.push({ role: "user", content: `[PROTOCOL] ${action.reason}` });
      continue;
    }

    const result = await runCommand(action.command, {
      cwd: config.repoPath,
      timeoutMs: config.commandTimeoutMs,
    });
    if (gitBacked && !result.blocked) {
      result.revertedPaths = await revertDisallowedChanges(
        config.repoPath,
        config.allowedWriteDirs,
        preexistingDirty,
      );
    }
    const step: Step = { index, assistant, action, result };
    steps.push(step);
    onStep?.(step);
    const output = [
      result.blocked ? `[BLOCKED] ${result.blockReason}` : `[exit ${result.exitCode}]`,
      result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
      result.stderr ? `stderr:\n${result.stderr}` : "",
      result.revertedPaths.length > 0 ? `reverted: ${result.revertedPaths.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    messages.push({ role: "user", content: output.slice(0, config.maxOutputChars) });
  }

  await writeFile(path.join(workspaceAbs, "trajectory.json"), JSON.stringify(steps, null, 2) + "\n", "utf8");
  return {
    finished: false,
    finalSpec,
    steps,
    stoppedReason: `Reached the step limit (${config.maxSteps}) without a conclusive final spec.`,
    workspaceDir,
  };
}
