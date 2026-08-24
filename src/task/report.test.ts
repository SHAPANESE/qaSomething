import { describe, expect, it } from "vitest";
import { renderTaskReport } from "./report.js";
import type { TaskRunResult } from "./runner.js";

describe("renderTaskReport", () => {
  it("includes verdict, oracle, mutation proof, and evidence", () => {
    const result: TaskRunResult = {
      schemaVersion: 1,
      runId: "run-1",
      taskId: "create-task",
      goal: "Create a task",
      status: "passed",
      classification: "verified",
      reason: "Passed.",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      spec: "tests/create.spec.ts",
      attempts: [
        {
          index: 1,
          passed: true,
          inconclusive: false,
          exitCode: 0,
          passedCount: 1,
          failedCount: 0,
          durationMs: 1,
          outputFile: "attempt-1.log",
          revertedPaths: [],
          evidence: {
            channels: ["ui"],
            oracleReached: true,
            responses: [],
            console: [],
            pageErrors: [],
          },
        },
      ],
      mutation: {
        spec: "tests/create.mutation.spec.ts",
        attempts: [],
        status: "meaningful",
        reason: "Failed.",
      },
      artifactsDir: ".qa-agent/task-runs/run-1",
    };
    const report = renderTaskReport(
      { version: 1, id: "create-task", goal: "Create", oracle: "One task" },
      result,
    );
    expect(report).toContain("# QA task: create-task");
    expect(report).toContain("**Oracle:** One task");
    expect(report).toContain("## Mutation proof");
    expect(report).toContain("channels=ui");
    expect(report).toContain("[log](attempt-1.log)");
  });
});
