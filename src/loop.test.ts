import { describe, expect, it } from "vitest";
import { formatObservation } from "./loop.js";
import type { CommandResult } from "./types.js";

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    command: "echo hi",
    blocked: false,
    stdout: "hi\n",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 5,
    revertedPaths: [],
    ...overrides,
  };
}

describe("formatObservation", () => {
  it("reports exit code and stdout", () => {
    const obs = formatObservation(result(), 10_000);
    expect(obs).toContain("[exit 0]");
    expect(obs).toContain("stdout:\nhi");
  });

  it("surfaces a blocked command with its reason and does not leak output", () => {
    const obs = formatObservation(
      result({ blocked: true, blockReason: "rm -rf is forbidden.", stdout: "", exitCode: null }),
      10_000,
    );
    expect(obs).toContain("[BLOCKED by guardrails]");
    expect(obs).toContain("rm -rf is forbidden.");
  });

  it("tells the agent when the guardrail reverted its changes", () => {
    const obs = formatObservation(result({ revertedPaths: ["src/app.ts"] }), 10_000);
    expect(obs).toContain("[GUARDRAIL]");
    expect(obs).toContain("src/app.ts");
    expect(obs).toMatch(/read-only|report it as a finding/i);
  });

  it("marks a timeout instead of an exit code", () => {
    const obs = formatObservation(result({ timedOut: true, exitCode: null, durationMs: 120_000 }), 10_000);
    expect(obs).toContain("timed out");
  });

  it("truncates oversized output", () => {
    const big = "x".repeat(50_000);
    const obs = formatObservation(result({ stdout: big }), 1_000);
    expect(obs.length).toBeLessThan(2_000);
    expect(obs).toContain("truncated");
  });

  it("includes stderr when present", () => {
    const obs = formatObservation(result({ stderr: "boom", exitCode: 1 }), 10_000);
    expect(obs).toContain("stderr:\nboom");
  });
});
