import { describe, expect, it } from "vitest";
import { classifyFailure, triageSpec } from "./triage.js";
import type { TestRunResult, TestRunner } from "./verify.js";

function run(passed: boolean, output = ""): TestRunResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    passedCount: passed ? 1 : 0,
    failedCount: passed ? 0 : 1,
    output,
  };
}

describe("classifyFailure", () => {
  it("classifies an assertion mismatch as a behavior regression", () => {
    const output = [
      "Error: expect(locator).toHaveText(expected) failed",
      'Expected: "Welcome, user@test.com"',
      'Received: "Welcome, intruder"',
    ].join("\n");
    const r = classifyFailure(output);
    expect(r.class).toBe("behavior-regression");
    expect(r.evidence).toMatch(/expected .* received/i);
  });

  it("classifies a toHaveText mismatch (Expected string:/Received string:) as a regression", () => {
    // toHaveText also prints "Timed out ... waiting for expect(...)" — the
    // Expected/Received signal must win, or a real regression looks like drift.
    const output = [
      "Timed out 5000ms waiting for expect(locator).toHaveText(expected)",
      'Expected string: "Invalid credentials"',
      'Received string: "Welcome"',
    ].join("\n");
    const r = classifyFailure(output);
    expect(r.class).toBe("behavior-regression");
    expect(r.evidence).toMatch(/Invalid credentials/);
  });

  it("classifies a locator timeout as drift", () => {
    const output = "Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'Sign in' })";
    expect(classifyFailure(output).class).toBe("locator-drift");
  });

  it("classifies 'resolved to 0 elements' as drift", () => {
    expect(classifyFailure("locator resolved to 0 elements").class).toBe("locator-drift");
  });

  it("returns unknown for an unrecognized failure", () => {
    expect(classifyFailure("some unrelated stack trace").class).toBe("unknown");
  });
});

describe("triageSpec", () => {
  const runner = (results: TestRunResult[]): TestRunner => {
    let i = 0;
    return async () => results[i++] ?? results[results.length - 1]!;
  };

  it("reports passing when all runs pass", async () => {
    const t = await triageSpec("x.spec.ts", 2, runner([run(true), run(true)]));
    expect(t.class).toBe("passing");
  });

  it("reports flaky on mixed runs", async () => {
    const t = await triageSpec("x.spec.ts", 3, runner([run(true), run(false), run(true)]));
    expect(t.class).toBe("flaky");
    expect(t.evidence).toMatch(/2\/3/);
  });

  it("classifies a consistently failing test from its output", async () => {
    const out = 'Expected: "a"\nReceived: "b"';
    const t = await triageSpec("x.spec.ts", 2, runner([run(false, out), run(false, out)]));
    expect(t.class).toBe("behavior-regression");
    expect(t.recommendation).toMatch(/bug|ticket/i);
  });

  it("classifies from errorText (JSON report) in preference to raw output", async () => {
    // Raw output is JSON chrome; the clean message lives in errorText.
    const failing: TestRunResult = {
      passed: false,
      exitCode: 1,
      passedCount: 0,
      failedCount: 1,
      output: '{"stats":{"unexpected":1}}',
      errorText: 'Expected string: "a"\nReceived string: "b"',
    };
    const t = await triageSpec("x.spec.ts", 2, runner([failing, failing]));
    expect(t.class).toBe("behavior-regression");
  });

  it("routes locator drift to repair mode", async () => {
    const out = "Timeout 5000ms exceeded.\nwaiting for getByRole('button')";
    const t = await triageSpec("x.spec.ts", 2, runner([run(false, out), run(false, out)]));
    expect(t.class).toBe("locator-drift");
    expect(t.recommendation).toMatch(/repair/i);
  });

  it("does not blame the test when the environment couldn't run", async () => {
    const bad: TestRunResult = {
      ...run(false, "Timed out waiting 20000ms from config.webServer"),
      inconclusive: true,
    };
    const t = await triageSpec("x.spec.ts", 2, runner([bad, bad]));
    expect(t.evidence).toMatch(/environment problem|not a test failure/i);
    expect(t.recommendation).toMatch(/not the test's fault/i);
  });
});
