import { describe, expect, it } from "vitest";
import { scoreEvals, type EvalCase } from "./eval.js";
import type { TestVerdict } from "./verify.js";

function verdict(spec: string, trusted: boolean): TestVerdict {
  return {
    spec,
    stability: trusted ? { kind: "stable-pass" } : { kind: "failing" },
    mutation: trusted ? { kind: "meaningful" } : { kind: "not-meaningful" },
    trusted,
    reasons: [],
  };
}

describe("scoreEvals", () => {
  const cases: EvalCase[] = [
    { spec: "tests/valid-login.spec.ts", expected: "trusted" },
    { spec: "tests/smoke.spec.ts", expected: "rejected" },
  ];

  it("scores a perfect run", () => {
    const report = scoreEvals(cases, [
      verdict("/abs/tests/valid-login.spec.ts", true),
      verdict("/abs/tests/smoke.spec.ts", false),
    ]);
    expect(report.score).toBe(1);
    expect(report.passed).toBe(2);
  });

  it("marks a case wrong when the gate misclassifies it", () => {
    const report = scoreEvals(cases, [
      verdict("/abs/tests/valid-login.spec.ts", true),
      verdict("/abs/tests/smoke.spec.ts", true), // should have been rejected
    ]);
    expect(report.score).toBe(0.5);
    const smoke = report.results.find((r) => r.spec.includes("smoke"));
    expect(smoke?.correct).toBe(false);
    expect(smoke?.actual).toBe("trusted");
  });

  it("treats a missing verdict as incorrect", () => {
    const report = scoreEvals(cases, [verdict("/abs/tests/valid-login.spec.ts", true)]);
    expect(report.passed).toBe(1);
    const smoke = report.results.find((r) => r.spec.includes("smoke"));
    expect(smoke?.correct).toBe(false);
    expect(smoke?.reasons[0]).toMatch(/no verdict/i);
  });

  it("matches regardless of path separators", () => {
    const report = scoreEvals(
      [{ spec: "tests\\valid-login.spec.ts", expected: "trusted" }],
      [verdict("/abs/tests/valid-login.spec.ts", true)],
    );
    expect(report.score).toBe(1);
  });
});
