import { describe, expect, it } from "vitest";
import {
  aggregateStability,
  checkMutationPolarity,
  decideVerdict,
  interpretRun,
  looksInconclusive,
  pairSpecs,
  parsePlaywrightJson,
  verdictToJson,
  verifySpec,
  type TestRunResult,
  type TestRunner,
} from "./verify.js";

/** Build a minimal Playwright `--reporter=json` payload for tests. */
function pwJson(opts: { expected?: number; unexpected?: number; flaky?: number; errors?: string[] }): string {
  return JSON.stringify({
    config: { version: "1.0.0" },
    suites: [
      {
        title: "example.spec.ts",
        specs: (opts.errors ?? []).map((message) => ({
          title: "a test",
          ok: false,
          tests: [{ results: [{ status: "failed", errors: [{ message }] }] }],
        })),
      },
    ],
    errors: [],
    stats: {
      expected: opts.expected ?? 0,
      unexpected: opts.unexpected ?? 0,
      flaky: opts.flaky ?? 0,
      skipped: 0,
      duration: 12,
    },
  });
}

function run(passed: boolean): TestRunResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    passedCount: passed ? 1 : 0,
    failedCount: passed ? 0 : 1,
    output: "",
  };
}

describe("interpretRun", () => {
  it("treats exit 0 with no failures as passed", () => {
    const r = interpretRun(0, "Running 1 test\n  1 passed (1.2s)");
    expect(r.passed).toBe(true);
    expect(r.passedCount).toBe(1);
  });

  it("treats a non-zero exit as failed", () => {
    const r = interpretRun(1, "  1 failed\n  0 passed");
    expect(r.passed).toBe(false);
    expect(r.failedCount).toBe(1);
  });

  it("does not report passed if the output shows failures even on exit 0", () => {
    const r = interpretRun(0, "2 passed\n1 failed");
    expect(r.passed).toBe(false);
  });
});

describe("parsePlaywrightJson", () => {
  it("reads pass/fail counts from stats", () => {
    const report = parsePlaywrightJson(pwJson({ expected: 3, unexpected: 1 }));
    expect(report).toMatchObject({ expected: 3, unexpected: 1 });
  });

  it("collects ANSI-stripped failure messages", () => {
    const report = parsePlaywrightJson(pwJson({ unexpected: 1, errors: ['[31mExpected string:[39m "a"'] }));
    expect(report?.errorMessages.join("")).toContain('Expected string: "a"');
    expect(report?.errorMessages.join("")).not.toContain("[");
  });

  it("tolerates web-server noise printed before the report", () => {
    const noisy = `> app@1.0.0 start\n{ server listening }\nboot ok\n${pwJson({ expected: 2 })}`;
    expect(parsePlaywrightJson(noisy)).toMatchObject({ expected: 2 });
  });

  it("returns null when there is no JSON report (env failure)", () => {
    expect(parsePlaywrightJson("Executable doesn't exist\nplaywright install")).toBeNull();
  });
});

describe("interpretRun — JSON reporter", () => {
  it("passes when stats show no unexpected failures on exit 0", () => {
    const r = interpretRun(0, pwJson({ expected: 2, unexpected: 0 }));
    expect(r.passed).toBe(true);
    expect(r.passedCount).toBe(2);
    expect(r.failedCount).toBe(0);
  });

  it("fails and surfaces errorText when stats show an unexpected failure", () => {
    const r = interpretRun(1, pwJson({ unexpected: 1, errors: ['Expected string: "x"'] }));
    expect(r.passed).toBe(false);
    expect(r.failedCount).toBe(1);
    expect(r.errorText).toContain('Expected string: "x"');
  });

  it("stays inconclusive when a report coexists with an env-failure signal", () => {
    const output = `${pwJson({ unexpected: 0 })}\nExecutable doesn't exist at ...\nplaywright install`;
    const r = interpretRun(1, output);
    expect(r.inconclusive).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("falls back to the line reporter when no JSON is present", () => {
    const r = interpretRun(0, "Running 1 test\n  1 passed (1.2s)");
    expect(r.passed).toBe(true);
    expect(r.passedCount).toBe(1);
  });
});

describe("looksInconclusive", () => {
  it("flags environment/tooling failures, not test failures", () => {
    expect(looksInconclusive("Error: No tests found", 1)).toBe(true);
    expect(looksInconclusive("Executable doesn't exist at ...\nplaywright install", 1)).toBe(true);
    expect(looksInconclusive("Timed out waiting 20000ms from config.webServer", 1)).toBe(true);
    expect(looksInconclusive("listen EADDRINUSE: address already in use", 1)).toBe(true);
    expect(looksInconclusive("anything", 127)).toBe(true);
  });
  it("flags a missing runner binary on both POSIX and Windows", () => {
    expect(looksInconclusive("bash: playwright: command not found", 127)).toBe(true);
    expect(looksInconclusive("'playwright' is not recognized as an internal or external command", 1)).toBe(
      true,
    );
    expect(looksInconclusive("Error: spawn playwright ENOENT", 1)).toBe(true);
  });
  it("does not flag a genuine assertion failure", () => {
    expect(looksInconclusive("Expected: a\nReceived: b\n1 failed", 1)).toBe(false);
  });
});

describe("aggregateStability", () => {
  it("is stable-pass when every run passes", () => {
    expect(aggregateStability([run(true), run(true), run(true)])).toEqual({ kind: "stable-pass" });
  });
  it("is failing when every run fails", () => {
    expect(aggregateStability([run(false), run(false)])).toEqual({ kind: "failing" });
  });
  it("is flaky when runs are mixed", () => {
    expect(aggregateStability([run(true), run(false), run(true)])).toEqual({
      kind: "flaky",
      passes: 2,
      runs: 3,
    });
  });
  it("is inconclusive when any run couldn't execute", () => {
    const bad: TestRunResult = { ...run(false), inconclusive: true };
    expect(aggregateStability([bad, run(false)])).toEqual({ kind: "inconclusive" });
  });
});

describe("decideVerdict — inconclusive", () => {
  it("is not trusted and explains it's an environment problem", () => {
    const v = decideVerdict("x.spec.ts", { kind: "inconclusive" }, { kind: "baseline-broken" });
    expect(v.trusted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/environment problem|not a test failure/i);
  });
});

describe("checkMutationPolarity", () => {
  it("is meaningful when real passes and mutation fails", () => {
    expect(checkMutationPolarity({ kind: "stable-pass" }, run(false))).toEqual({ kind: "meaningful" });
  });
  it("is not-meaningful when the mutation still passes", () => {
    expect(checkMutationPolarity({ kind: "stable-pass" }, run(true))).toEqual({ kind: "not-meaningful" });
  });
  it("is baseline-broken when the real test is not a stable pass", () => {
    expect(checkMutationPolarity({ kind: "failing" }, run(false))).toEqual({ kind: "baseline-broken" });
  });
  it("flags a missing mutation proof", () => {
    expect(checkMutationPolarity({ kind: "stable-pass" }, null)).toEqual({ kind: "no-mutation-proof" });
  });
});

describe("decideVerdict", () => {
  it("trusts a stable, meaningful test", () => {
    const v = decideVerdict("login.spec.ts", { kind: "stable-pass" }, { kind: "meaningful" });
    expect(v.trusted).toBe(true);
  });
  it("rejects an always-green (not-meaningful) test", () => {
    const v = decideVerdict("x.spec.ts", { kind: "stable-pass" }, { kind: "not-meaningful" });
    expect(v.trusted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/don't verify real behavior/i);
  });
  it("rejects a flaky test", () => {
    const v = decideVerdict("x.spec.ts", { kind: "flaky", passes: 2, runs: 3 }, { kind: "baseline-broken" });
    expect(v.trusted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/flaky/i);
  });
});

describe("verdictToJson", () => {
  it("flattens a verdict to a CI-consumable shape", () => {
    const json = verdictToJson(
      decideVerdict("login.spec.ts", { kind: "stable-pass" }, { kind: "meaningful" }),
    );
    expect(json).toMatchObject({
      spec: "login.spec.ts",
      trusted: true,
      stability: "stable-pass",
      mutation: "meaningful",
    });
    expect(Array.isArray(json.reasons)).toBe(true);
  });
});

describe("pairSpecs", () => {
  it("pairs a real spec with its mutation sibling", () => {
    expect(pairSpecs(["tests/login.spec.ts", "tests/login.mutation.spec.ts"])).toEqual([
      { spec: "tests/login.spec.ts", mutation: "tests/login.mutation.spec.ts" },
    ]);
  });

  it("leaves mutation null when there is no sibling", () => {
    expect(pairSpecs(["tests/login.spec.ts"])).toEqual([{ spec: "tests/login.spec.ts", mutation: null }]);
  });

  it("does not treat a mutation file as its own real spec", () => {
    const pairs = pairSpecs(["a.mutation.spec.ts"]);
    expect(pairs).toEqual([]);
  });

  it("normalizes backslash paths", () => {
    expect(pairSpecs(["tests\\login.spec.ts", "tests\\login.mutation.spec.ts"])).toEqual([
      { spec: "tests/login.spec.ts", mutation: "tests/login.mutation.spec.ts" },
    ]);
  });
});

describe("verifySpec (orchestration)", () => {
  it("runs the baseline N times and one mutation run, and trusts a good test", async () => {
    const calls: string[] = [];
    const runner: TestRunner = async (spec) => {
      calls.push(spec);
      return spec.includes("mutation") ? run(false) : run(true);
    };
    const verdict = await verifySpec("login.spec.ts", "login.mutation.spec.ts", 3, runner);
    expect(calls).toEqual(["login.spec.ts", "login.spec.ts", "login.spec.ts", "login.mutation.spec.ts"]);
    expect(verdict.trusted).toBe(true);
  });

  it("skips the mutation run when the baseline is not stable", async () => {
    const calls: string[] = [];
    const runner: TestRunner = async (spec) => {
      calls.push(spec);
      return run(false);
    };
    const verdict = await verifySpec("x.spec.ts", "x.mutation.spec.ts", 2, runner);
    expect(calls).toEqual(["x.spec.ts", "x.spec.ts"]);
    expect(verdict.trusted).toBe(false);
  });

  it("rejects when the mutation proof passes (assertions are hollow)", async () => {
    const runner: TestRunner = async () => run(true);
    const verdict = await verifySpec("x.spec.ts", "x.mutation.spec.ts", 2, runner);
    expect(verdict.trusted).toBe(false);
    expect(verdict.mutation.kind).toBe("not-meaningful");
  });
});
