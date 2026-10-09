import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execa } from "execa";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TestRunResult, TestRunner } from "../verify.js";
import { classifyTaskRuns, runTask } from "./runner.js";
import type { QATask } from "./schema.js";

function outcome(passed: boolean, inconclusive = false): TestRunResult {
  return {
    passed,
    exitCode: inconclusive ? null : passed ? 0 : 1,
    passedCount: passed ? 1 : 0,
    failedCount: passed || inconclusive ? 0 : 1,
    output: passed ? "1 passed" : inconclusive ? "runner unavailable" : "1 failed",
    ...(inconclusive ? { inconclusive: true } : {}),
  };
}

describe("classifyTaskRuns", () => {
  it("passes only when every clean attempt passes", () => {
    expect(classifyTaskRuns([outcome(true), outcome(true)]).status).toBe("passed");
  });

  it("fails when every clean attempt fails", () => {
    expect(classifyTaskRuns([outcome(false), outcome(false)]).status).toBe("failed");
  });

  it("is inconclusive for mixed or environment results", () => {
    expect(classifyTaskRuns([outcome(true), outcome(false)]).status).toBe("inconclusive");
    expect(classifyTaskRuns([outcome(false, true)]).status).toBe("inconclusive");
  });

  it("is inconclusive when declared evidence is missing", () => {
    const verdict = classifyTaskRuns([outcome(true), outcome(true)], ["ui"]);
    expect(verdict.status).toBe("inconclusive");
    expect(verdict.reason).toContain("ui evidence");
  });

  it("accepts declared evidence only when every attempt captured it", () => {
    const evidenced = {
      ...outcome(true),
      evidence: {
        channels: ["ui" as const],
        oracleReached: true,
        responses: [],
        console: [],
        pageErrors: [],
      },
    };
    expect(classifyTaskRuns([evidenced, evidenced], ["ui"]).status).toBe("passed");
  });
});

describe("runTask", () => {
  it("writes an isolated, replayable run workspace", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-"));
    await mkdir(path.join(repoPath, "tests"));
    const task: QATask = {
      version: 1,
      id: "create-task",
      goal: "Create a task and verify persistence",
      oracle: "One task is created and visible.",
      spec: "tests/create-task.spec.ts",
      mutationSpec: "tests/create-task.mutation.spec.ts",
      attempts: 2,
    };
    const runner: TestRunner = async (spec) => outcome(!spec.endsWith(".mutation.spec.ts"));
    const times = [new Date("2026-08-10T12:00:00.000Z"), new Date("2026-08-10T12:00:02.000Z")];
    const result = await runTask({
      repoPath,
      task,
      runner,
      clock: { now: () => times.shift()! },
    });

    expect(result.status).toBe("passed");
    expect(result.attempts).toHaveLength(2);
    const saved = JSON.parse(await readFile(path.join(repoPath, result.artifactsDir, "result.json"), "utf8"));
    expect(saved).toMatchObject({ taskId: "create-task", status: "passed" });
    expect(await readFile(path.join(repoPath, result.artifactsDir, "attempt-1.log"), "utf8")).toContain(
      "1 passed",
    );
  });

  it("does not verify a passing task without a mutation proof", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-mutation-required-"));
    await mkdir(path.join(repoPath, "tests"));
    const result = await runTask({
      repoPath,
      task: {
        version: 1,
        id: "create-task",
        goal: "Create a task",
        oracle: "One task is created.",
        spec: "tests/create-task.spec.ts",
      },
      runner: async () => outcome(true),
    });

    expect(result.status).toBe("inconclusive");
    expect(result.classification).toBe("insufficient_evidence");
    expect(result.reason).toContain("No mutationSpec");
  });

  it("does not verify a passing task without an explicit oracle", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-oracle-required-"));
    await mkdir(path.join(repoPath, "tests"));
    const result = await runTask({
      repoPath,
      task: {
        version: 1,
        id: "create-task",
        goal: "Create a task",
        spec: "tests/create-task.spec.ts",
        mutationSpec: "tests/create-task.mutation.spec.ts",
      },
      runner: async (spec) => outcome(!spec.endsWith(".mutation.spec.ts")),
    });

    expect(result.status).toBe("inconclusive");
    expect(result.classification).toBe("insufficient_evidence");
    expect(result.reason).toContain("No explicit oracle");
  });

  it("does not execute a task explicitly blocked by safety", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-"));
    const task: QATask = {
      version: 1,
      id: "send-email",
      goal: "Invite a user",
      spec: "tests/invite.spec.ts",
      attempts: 2,
      blockedReason: "External email is forbidden.",
    };
    let calls = 0;
    const result = await runTask({
      repoPath,
      task,
      runner: async () => {
        calls++;
        return outcome(true);
      },
    });
    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("forbidden");
    expect(calls).toBe(0);
  });

  it("requires the sibling mutation spec to fail before calling a passing task verified", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-mutation-"));
    await mkdir(path.join(repoPath, "tests"));
    const task: QATask = {
      version: 1,
      id: "create-task",
      goal: "Create a task",
      oracle: "One task is created.",
      spec: "tests/create-task.spec.ts",
      mutationSpec: "tests/create-task.mutation.spec.ts",
      attempts: 2,
    };
    const result = await runTask({
      repoPath,
      task,
      runner: async (spec) => outcome(!spec.endsWith(".mutation.spec.ts")),
    });

    expect(result.status).toBe("passed");
    expect(result.mutation).toMatchObject({
      status: "meaningful",
      attempts: [{ passed: false }, { passed: false }],
    });
    expect(
      await readFile(path.join(repoPath, result.artifactsDir, "mutation-attempt-1.log"), "utf8"),
    ).toContain("1 failed");
  });

  it("does not call a task verified when its mutation still passes", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-mutation-"));
    await mkdir(path.join(repoPath, "tests"));
    const result = await runTask({
      repoPath,
      task: {
        version: 1,
        id: "create-task",
        goal: "Create a task",
        oracle: "One task is created.",
        spec: "tests/create-task.spec.ts",
        mutationSpec: "tests/create-task.mutation.spec.ts",
        attempts: 1,
      },
      runner: async () => outcome(true),
    });

    expect(result.status).toBe("inconclusive");
    expect(result.classification).toBe("insufficient_evidence");
    expect(result.mutation?.status).toBe("not_meaningful");
  });

  it("does not call a task verified when its mutation fails before the oracle", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-mutation-"));
    await mkdir(path.join(repoPath, "tests"));
    const evidence = { channels: [], oracleReached: false, responses: [], console: [], pageErrors: [] };
    const result = await runTask({
      repoPath,
      task: {
        version: 1,
        id: "create-task",
        goal: "Create a task",
        oracle: "One task is created.",
        spec: "tests/create-task.spec.ts",
        mutationSpec: "tests/create-task.mutation.spec.ts",
        attempts: 1,
      },
      runner: async (spec) =>
        spec.endsWith(".mutation.spec.ts") ? { ...outcome(false), evidence } : outcome(true),
    });

    expect(result.status).toBe("inconclusive");
    expect(result.mutation?.status).toBe("not_meaningful");
    expect(result.mutation?.reason).toContain("before reaching the oracle");
  });

  it("reverts app-source writes made while a generated spec executes", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-task-guard-"));
    await mkdir(path.join(repoPath, "tests"));
    await writeFile(path.join(repoPath, "server.mjs"), "export const safe = true;\n");
    await execa("git", ["init", "-q"], { cwd: repoPath });
    await execa("git", ["add", "-A"], { cwd: repoPath });
    await execa("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], {
      cwd: repoPath,
    });
    const guardedTask: QATask = {
      version: 1,
      id: "guarded",
      goal: "Do not modify source",
      oracle: "The app source remains unchanged.",
      spec: "tests/guarded.spec.ts",
      mutationSpec: "tests/guarded.mutation.spec.ts",
      attempts: 1,
    };
    const result = await runTask({
      repoPath,
      task: guardedTask,
      runner: async (spec) => {
        if (spec.endsWith(".mutation.spec.ts")) return outcome(false);
        await writeFile(path.join(repoPath, "server.mjs"), "export const injected = true;\n");
        return outcome(true);
      },
    });

    expect(result.status).toBe("passed");
    expect(result.attempts[0]?.revertedPaths).toContain("server.mjs");
    expect(await readFile(path.join(repoPath, "server.mjs"), "utf8")).toContain("safe = true");
  });
});
