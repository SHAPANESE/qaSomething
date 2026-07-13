import { describe, expect, it } from "vitest";
import { renderReport } from "./report.js";
import { computeCoverage } from "./run.js";
import type { TestCase } from "./cases.js";

const mk = (id: string, status: TestCase["status"], ac: string): TestCase => ({
  id,
  ac,
  priority: "high",
  category: "happy",
  status,
  description: "d",
});

describe("renderReport", () => {
  const cases = [
    mk("TC-X-01", "passing", "AC-1"),
    mk("TC-X-02", "bug", "AC-2"),
    mk("TC-X-03", "planned", "AC-3"),
  ];
  const md = renderReport({
    ticketId: "PROJ-42",
    date: "2026-07-13",
    cases,
    coverage: computeCoverage(cases),
    gaps: "GAP: whitespace-only email undefined",
    findings: ["PROJ-42-bug-1.md"],
  });

  it("headlines the ticket and coverage", () => {
    expect(md).toContain("# QA sign-off — PROJ-42");
    expect(md).toContain("33%"); // 1 passing of 3
  });
  it("lists trusted (passing) cases and bugs separately", () => {
    expect(md).toContain("TC-X-01");
    expect(md).toContain("TC-X-02");
    expect(md).toContain("PROJ-42-bug-1.md");
  });
  it("calls out what is NOT covered (planned/authored, not passing)", () => {
    expect(md).toMatch(/not covered[\s\S]*TC-X-03/i);
  });
  it("includes the gaps", () => {
    expect(md).toContain("whitespace-only email undefined");
  });
});
