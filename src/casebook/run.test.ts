import { describe, expect, it } from "vitest";
import { computeCoverage, parseRun, serializeRun, type RunRecord } from "./run.js";
import type { TestCase } from "./cases.js";

const mk = (id: string, status: TestCase["status"]): TestCase => ({
  id,
  ac: "ac",
  priority: "high",
  category: "happy",
  status,
  description: "d",
});

describe("parseRun / serializeRun", () => {
  it("round-trips a run record", () => {
    const r: RunRecord = {
      date: "2026-07-13T00:00:00.000Z",
      results: [
        { spec: "tests/a.spec.ts", caseId: "TC-X-01", outcome: "pass" },
        { spec: "tests/b.spec.ts", outcome: "fail" },
      ],
    };
    expect(parseRun(serializeRun(r))).toEqual(r);
  });
  it("rejects an unknown outcome", () => {
    const raw = JSON.stringify({ date: "d", results: [{ spec: "s", outcome: "boom" }] });
    expect(() => parseRun(raw)).toThrow();
  });
  it("accepts the manual run record qa-manual writes", () => {
    const raw = JSON.stringify({
      date: "2026-07-22",
      method: "manual-playwright",
      env: "dev",
      results: [
        { caseId: "TC-X-01", outcome: "blocked", evidence: "No BROKER_USER login." },
        { caseId: "TC-X-02", outcome: "pass", evidence: "POST /api/invitations → 200" },
      ],
    });
    expect(parseRun(raw).results.map((r) => r.outcome)).toEqual(["blocked", "pass"]);
  });
  it("rejects a result with neither spec nor caseId", () => {
    expect(() => parseRun(JSON.stringify({ date: "d", results: [{ outcome: "pass" }] }))).toThrow();
  });
});

describe("computeCoverage", () => {
  it("counts statuses and computes covered percentage from passing/total", () => {
    const cases = [
      mk("TC-X-01", "passing"),
      mk("TC-X-02", "failing"),
      mk("TC-X-03", "passing"),
      mk("TC-X-04", "planned"),
      mk("TC-X-05", "blocked"),
    ];
    const cov = computeCoverage(cases);
    expect(cov).toEqual({
      total: 5,
      planned: 1,
      authored: 0,
      passing: 2,
      failing: 1,
      flaky: 0,
      bug: 0,
      blocked: 1,
      coveredPct: 40,
    });
  });
  it("is zero-safe for an empty casebook", () => {
    expect(computeCoverage([]).coveredPct).toBe(0);
  });
});
