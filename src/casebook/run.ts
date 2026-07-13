import { z } from "zod";
import type { CaseStatus, TestCase } from "./cases.js";

/**
 * A run record (`.qa-agent/runs/<date>.json`): the outcome of running each spec,
 * linked to its case id where the spec carries a `// case:` tag. Coverage is
 * computed from the cases' statuses (the casebook is the source of truth after a
 * run updates them).
 */

export const CASE_OUTCOMES = ["pass", "fail", "inconclusive"] as const;
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

export const CaseRunResultSchema = z
  .object({
    spec: z.string().min(1),
    caseId: z.string().optional(),
    outcome: z.enum(CASE_OUTCOMES),
  })
  .strict();
export type CaseRunResult = z.infer<typeof CaseRunResultSchema>;

export const RunRecordSchema = z
  .object({
    date: z.string().min(1),
    results: z.array(CaseRunResultSchema),
  })
  .strict();
export type RunRecord = z.infer<typeof RunRecordSchema>;

export function parseRun(raw: string): RunRecord {
  return RunRecordSchema.parse(JSON.parse(raw));
}

export function serializeRun(record: RunRecord): string {
  return JSON.stringify(record, null, 2) + "\n";
}

export interface Coverage {
  total: number;
  planned: number;
  authored: number;
  passing: number;
  failing: number;
  flaky: number;
  bug: number;
  coveredPct: number;
}

export function computeCoverage(cases: TestCase[]): Coverage {
  const count = (s: CaseStatus): number => cases.filter((c) => c.status === s).length;
  const total = cases.length;
  const passing = count("passing");
  return {
    total,
    planned: count("planned"),
    authored: count("authored"),
    passing,
    failing: count("failing"),
    flaky: count("flaky"),
    bug: count("bug"),
    coveredPct: total === 0 ? 0 : Math.round((passing / total) * 100),
  };
}
