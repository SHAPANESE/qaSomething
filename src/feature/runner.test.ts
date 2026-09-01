import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TaskAgentResult } from "../task/agent.js";
import { runFeatureCampaign, toScenarioTask } from "./runner.js";
import { featureSchema, qaPlanSchema } from "./schema.js";

const feature = featureSchema.parse({
  version: 1,
  id: "checkout-coupon",
  goal: "Apply a coupon",
  acceptanceCriteria: [
    {
      id: "ac-1",
      text: "The total includes the discount",
      oracleChecks: [{ kind: "text_visible", text: "$90", exact: true }],
    },
  ],
  coverage: { matrix: ["chromium", "Mobile Chrome"] },
  supervision: { mode: "approve_risky" },
});

const browserScenario = qaPlanSchema.parse({
  version: 1,
  featureId: feature.id,
  summary: "Test the coupon",
  risks: [],
  scenarios: [
    {
      id: "apply-coupon",
      title: "Apply a valid coupon",
      criterionIds: ["ac-1"],
      technique: "happy_path",
      execution: "browser",
      priority: "p0",
      goal: "Apply the coupon",
      oracle: "The total is $90",
      evidence: ["ui", "network"],
      rationale: "Core checkout path",
    },
  ],
  excluded: [],
}).scenarios[0]!;

describe("toScenarioTask", () => {
  it("turns a planned scenario into an independently verifiable task", () => {
    const task = toScenarioTask(feature, browserScenario);

    expect(task).toMatchObject({
      id: "checkout-coupon-apply-coupon",
      oracle: "The total is $90",
      execution: { projects: ["chromium", "Mobile Chrome"] },
      supervision: { mode: "approve_risky", checkpointBeforePlan: true },
    });
    expect(task.oracleChecks).toEqual([{ kind: "text_visible", text: "$90", exact: true }]);
  });
});

describe("runFeatureCampaign", () => {
  it("executes the planned browser scenario and writes a coverage report", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-feature-"));
    const plan = qaPlanSchema.parse({
      version: 1,
      featureId: feature.id,
      summary: "Test the coupon",
      risks: [],
      scenarios: [browserScenario],
      excluded: [{ area: "performance", reason: "Not load-sensitive" }],
    });
    const agent: TaskAgentResult = {
      finished: true,
      finalSpec: "tests/qa-generated/coupon.spec.ts",
      replayTaskFile: ".qa-agent/task-work/coupon/task.generated.json",
      steps: [],
      workspaceDir: ".qa-agent/task-work/coupon",
      verification: {
        schemaVersion: 1,
        runId: "run-1",
        taskId: "checkout-coupon-apply-coupon",
        goal: "Apply coupon",
        status: "passed",
        classification: "verified",
        reason: "Passed twice",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:01:00.000Z",
        spec: "tests/qa-generated/coupon.spec.ts",
        attempts: [],
        artifactsDir: ".qa-agent/task-runs/run-1",
        reportFile: ".qa-agent/task-runs/run-1/report.md",
      },
    };
    const runBrowser = vi.fn(async () => ({ agent }));

    const result = await runFeatureCampaign({ repoPath, feature, plan, runBrowser });

    expect(result.status).toBe("passed");
    expect(runBrowser).toHaveBeenCalledWith(expect.objectContaining({ id: "checkout-coupon-apply-coupon" }), [
      "chromium",
      "Mobile Chrome",
    ]);
    const report = await readFile(path.join(repoPath, result.reportFile), "utf8");
    expect(report).toContain("ac-1");
    expect(report).toContain("performance");
  });

  it("stops the campaign when a supervised scenario pauses", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-feature-"));
    const second = { ...browserScenario, id: "second", title: "Second scenario" };
    const plan = qaPlanSchema.parse({
      version: 1,
      featureId: feature.id,
      summary: "Test the coupon",
      risks: [],
      scenarios: [browserScenario, second],
      excluded: [],
    });
    const runBrowser = vi.fn(async () => ({
      agent: {
        finished: false,
        paused: true,
        finalSpec: "tests/qa-generated/coupon.spec.ts",
        replayTaskFile: ".qa-agent/task-work/coupon/task.generated.json",
        steps: [],
        stoppedReason: "Waiting for approval",
        workspaceDir: ".qa-agent/task-work/coupon",
      } satisfies TaskAgentResult,
    }));

    const result = await runFeatureCampaign({ repoPath, feature, plan, runBrowser });

    expect(result.status).toBe("paused");
    expect(result.scenarios).toHaveLength(1);
    expect(runBrowser).toHaveBeenCalledOnce();
  });

  it("routes API contract scenarios to the API runner", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-feature-"));
    const apiFeature = featureSchema.parse({
      version: 1,
      id: "coupon-api",
      goal: "Validate coupon API",
      acceptanceCriteria: [{ id: "ac-1", text: "The API follows its contract" }],
      api: { spec: "openapi.yaml", url: "http://localhost:3000" },
      coverage: { e2e: "skip", api: "required" },
    });
    const plan = qaPlanSchema.parse({
      version: 1,
      featureId: apiFeature.id,
      summary: "Validate the API contract",
      risks: [],
      scenarios: [
        {
          id: "contract",
          title: "Exercise the coupon contract",
          criterionIds: ["ac-1"],
          technique: "api_contract",
          execution: "api_contract",
          priority: "p0",
          goal: "Generate positive and negative API examples",
          oracle: "Every response conforms to the API contract",
          evidence: ["network"],
          rationale: "The contract is the authoritative API oracle",
        },
      ],
      excluded: [],
    });
    const runApi = vi.fn(async () => ({
      result: {
        passed: true,
        exitCode: 0,
        report: { tests: 4, failures: 0, errors: 0, skipped: 0, operations: [] },
        failures: [],
        output: "4 passed",
      },
    }));

    const result = await runFeatureCampaign({
      repoPath,
      feature: apiFeature,
      plan,
      runBrowser: vi.fn(),
      runApi,
    });

    expect(result.status).toBe("passed");
    expect(runApi).toHaveBeenCalledOnce();
    expect(result.scenarios[0]?.contract?.passed).toBe(true);
  });
});
