import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { commandRisk, createSupervisionController, type ApprovalHandler } from "./supervision.js";

describe("commandRisk", () => {
  it("only treats confidently read-only shell commands as read operations", () => {
    expect(commandRisk("rg -n TODO src")).toBe("read");
    expect(commandRisk("git status --short")).toBe("read");
    expect(commandRisk("Get-Content README.md")).toBe("read");
    expect(commandRisk("npx playwright test tests/login.spec.ts")).toBe("write_or_execute");
    expect(commandRisk("node probe.mjs")).toBe("write_or_execute");
    expect(commandRisk("echo data > result.txt")).toBe("write_or_execute");
    expect(commandRisk("rg TODO src && touch result.txt")).toBe("write_or_execute");
    expect(commandRisk('rg "$(touch result.txt)" src')).toBe("write_or_execute");
    expect(commandRisk("find src -delete")).toBe("write_or_execute");
    expect(commandRisk("rg --pre node TODO src")).toBe("write_or_execute");
    expect(commandRisk("git diff --output=result.patch")).toBe("write_or_execute");
  });
});

describe("supervision controller", () => {
  it("auto-approves reads but asks before risky commands", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-supervision-"));
    const handler: ApprovalHandler = vi.fn(async () => ({ outcome: "approve", scope: "once" }));
    const controller = await createSupervisionController({
      repoPath,
      taskId: "login",
      policy: { mode: "approve_risky", checkpointBeforeExecution: true, checkpointBeforeFinding: true },
      handler,
    });

    const read = await controller.requestCommand("rg -n login src");
    const execute = await controller.requestCommand("npx playwright test tests/login.spec.ts");

    expect(read.outcome).toBe("approve");
    expect(read.automatic).toBe(true);
    expect(execute.outcome).toBe("approve");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reuses session-scoped approval and persists an audit log", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-supervision-"));
    const handler: ApprovalHandler = vi.fn(async () => ({
      outcome: "approve",
      scope: "session",
      reviewer: "qa@example.test",
    }));
    const args = {
      repoPath,
      taskId: "login",
      policy: {
        mode: "approve_all" as const,
        checkpointBeforeExecution: true,
        checkpointBeforeFinding: true,
      },
      handler,
    };
    const controller = await createSupervisionController(args);

    await controller.requestCommand("node first-probe.mjs");
    await controller.requestCommand("node second-probe.mjs");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(controller.session.decisions).toHaveLength(2);
    expect(controller.session.decisions[1]?.automatic).toBe(true);

    const resumed = await createSupervisionController(args);
    await resumed.requestCommand("node third-probe.mjs");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(resumed.session.decisions.at(-1)?.automatic).toBe(true);
  });

  it("records a pause without authorizing the requested operation", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-supervision-"));
    const controller = await createSupervisionController({
      repoPath,
      taskId: "login",
      policy: { mode: "approve_all", checkpointBeforeExecution: true, checkpointBeforeFinding: true },
      handler: async () => ({ outcome: "pause", scope: "once", note: "Need product input" }),
    });

    const decision = await controller.requestCommand("node probe.mjs");

    expect(decision.outcome).toBe("pause");
    expect(controller.session.status).toBe("paused");
    expect(controller.session.decisions[0]?.note).toBe("Need product input");
  });
});
