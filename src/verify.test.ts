import { describe, expect, it } from "vitest";
import {
  aggregateStability,
  checkMutationPolarity,
  decideVerdict,
  interpretRun,
  pairSpecs,
  verifySpec,
  type TestRunResult,
  type TestRunner,
} from "./verify.js";

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
