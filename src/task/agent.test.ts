import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import type { Model } from "../model.js";
import type { RuntimeEvidence, TestRunResult, TestRunner } from "../verify.js";
import { runTaskAgent } from "./agent.js";
import type { QATask } from "./schema.js";

class DoneModel implements Model {
  readonly id = "done";
  calls = 0;
  async generate(): Promise<string> {
    this.calls++;
    return "```done\nfinished\n```";
  }
}

const task: QATask = {
  version: 1,
  id: "create-task",
  goal: "Create a task",
  oracle: "Exactly one task is created",
  attempts: 2,
};

async function writeSequence(
  repoPath: string,
  actions: Array<{ id: string; intent: string; code: string; required: boolean }> = [
    { id: "navigate", intent: "Open tasks", code: 'await page.goto("/tasks")', required: true },
  ],
): Promise<void> {
  const workDir = path.join(repoPath, ".qa-agent", "task-work", "create-task");
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(workDir, "sequence.json"),
    JSON.stringify({
      version: 1,
      taskId: "create-task",
      title: "creates one task",
      actions,
      assertion: { intent: "One task exists", code: "await expect(page).toHaveURL(/tasks/)" },
      mutation: {
        intent: "Reject task creation",
        code: 'await page.route("**/api/tasks", route => route.fulfill({ status: 500 }))',
        risk: "read",
      },
    }),
  );
}

function run(passed: boolean, inconclusive = false): TestRunResult {
  return {
    passed,
    exitCode: inconclusive ? null : passed ? 0 : 1,
    passedCount: passed ? 1 : 0,
    failedCount: passed || inconclusive ? 0 : 1,
    output: passed ? "pass" : "failure",
    ...(inconclusive ? { inconclusive: true } : {}),
    ...(!inconclusive
      ? {
          evidence: {
            channels: ["ui", "network", "console", "screenshot"] as RuntimeEvidence["channels"],
            oracleReached: true,
            responses: [],
            console: [],
            pageErrors: [],
          },
        }
      : {}),
  };
}

describe("runTaskAgent completion gate", () => {
  it("rejects done until the final spec exists", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    const model = new DoneModel();
    let runnerCalls = 0;
    const result = await runTaskAgent({
      model,
      task,
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner: async () => {
        runnerCalls++;
        return run(true);
      },
    });

    expect(result.finished).toBe(false);
    expect(result.stoppedReason).toContain("without a conclusive final spec");
    expect(model.calls).toBe(2);
    expect(runnerCalls).toBe(0);
  });

  it("accepts a final spec only after independent repeated verification", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath);
    let runnerCalls = 0;
    const runner: TestRunner = async (spec) => {
      runnerCalls++;
      return run(!spec.endsWith(".mutation.spec.ts"));
    };
    const result = await runTaskAgent({
      model: new DoneModel(),
      task,
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner,
    });

    expect(result.finished).toBe(true);
    expect(result.verification?.status).toBe("passed");
    expect(runnerCalls).toBe(4);
    expect(result.mutation?.status).toBe("meaningful");
    const replayTask = JSON.parse(await readFile(path.join(repoPath, result.replayTaskFile), "utf8"));
    expect(replayTask).toMatchObject({
      spec: "tests/qa-generated/create-task.spec.ts",
      mutationSpec: "tests/qa-generated/create-task.mutation.spec.ts",
    });
  });

  it("does not finish on inconclusive verification", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath);
    const model = new DoneModel();
    const result = await runTaskAgent({
      model,
      task: { ...task, attempts: 1 },
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner: async () => run(false, true),
    });

    expect(result.finished).toBe(false);
    expect(model.calls).toBe(2);
  });

  it("accepts a consistently failing spec as a reproducible behavior failure", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath);
    const result = await runTaskAgent({
      model: new DoneModel(),
      task,
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner: async () => run(false),
    });

    expect(result.finished).toBe(true);
    expect(result.verification?.status).toBe("failed");
    expect(result.verification?.attempts).toHaveLength(2);
    expect(result.mutation).toBeUndefined();
  });

  it("does not accept a passing task when its mutation also passes", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath);
    const model = new DoneModel();
    const result = await runTaskAgent({
      model,
      task: { ...task, attempts: 1 },
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner: async () => run(true),
    });

    expect(result.finished).toBe(false);
    expect(model.calls).toBe(2);
  });

  it("minimizes a failure and re-verifies the generated final spec", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath, [
      { id: "navigate", intent: "Open tasks", code: 'await page.goto("/tasks")', required: true },
      {
        id: "noise",
        intent: "Open and close help",
        code: "await page.keyboard.press('Escape')",
        required: false,
      },
      {
        id: "trigger",
        intent: "Trigger duplicate",
        code: "await page.getByRole('button').dblclick()",
        required: false,
      },
    ]);
    const runner: TestRunner = async (spec) => {
      const source = await readFile(spec, "utf8");
      return source.includes("action:trigger") ? run(false) : run(true);
    };
    const result = await runTaskAgent({
      model: new DoneModel(),
      task,
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner,
    });

    expect(result.finished).toBe(true);
    expect(result.verification?.status).toBe("failed");
    expect(result.shrink?.removedActionIds).toContain("noise");
    const finalSource = await readFile(path.join(repoPath, result.finalSpec), "utf8");
    expect(finalSource).not.toContain("action:noise");
    expect(finalSource).toContain("action:trigger");
  });

  it("pauses before executing an unapproved browser sequence", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath);
    let runnerCalls = 0;
    const result = await runTaskAgent({
      model: new DoneModel(),
      task: {
        ...task,
        supervision: {
          mode: "approve_risky",
          checkpointBeforeExecution: true,
          checkpointBeforeFinding: true,
        },
      },
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner: async () => {
        runnerCalls++;
        return run(true);
      },
      approvalHandler: async () => ({ outcome: "pause", scope: "once" }),
    });

    expect(result.finished).toBe(false);
    expect(result.paused).toBe(true);
    expect(result.stoppedReason).toContain("before browser execution");
    expect(result.approvalLogFile).toContain("supervision.json");
    expect(runnerCalls).toBe(0);
  });

  it("keeps the technical verdict separate from human finding review", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-agent-task-"));
    await writeSequence(repoPath);
    const result = await runTaskAgent({
      model: new DoneModel(),
      task: {
        ...task,
        supervision: {
          mode: "approve_risky",
          checkpointBeforeExecution: true,
          checkpointBeforeFinding: true,
        },
      },
      config: resolveConfig(repoPath, { maxSteps: 2 }),
      runner: async () => run(false),
      approvalHandler: async (request) =>
        request.kind === "finding"
          ? { outcome: "deny", scope: "once", note: "Expected behavior" }
          : { outcome: "approve", scope: "once" },
    });

    expect(result.finished).toBe(true);
    expect(result.verification?.status).toBe("failed");
    expect(result.findingReview).toMatchObject({
      kind: "finding",
      outcome: "deny",
      note: "Expected behavior",
    });
  });
});
