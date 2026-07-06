import path from "node:path";
import { playwrightRunner, type TestRunner, type TestRunResult } from "./verify.js";

/**
 * Mission #6 — Triage. When a test fails, classify WHY and route to the right
 * fix. The signal is mechanical: Playwright distinguishes a locator/timeout
 * failure (the element wasn't found → the UI drifted) from an assertion
 * mismatch (the element was there but the value was wrong → behavior changed).
 *
 * This ties the missions together: a locator-drift failure routes to repair
 * (Mission #2); a behavior-regression routes to a bug report. Never "repair" a
 * regression — that would hide the bug.
 */

export type FailureClass = "passing" | "flaky" | "locator-drift" | "behavior-regression" | "unknown";

export interface Triage {
  spec: string;
  class: FailureClass;
  evidence: string;
  recommendation: string;
}

const LOCATOR_SIGNALS: RegExp[] = [
  /Timeout.*waiting for/i,
  /waiting for (get\w+|locator|element)/i,
  /resolved to 0 elements/i,
  /strict mode violation/i,
  /No element matches/i,
  /element is not (visible|attached|enabled)/i,
];

const RECOMMENDATION: Record<FailureClass, string> = {
  passing: "No action — the test is stable.",
  flaky: "Stabilize: remove timing dependence; rely on Playwright auto-waiting and semantic locators.",
  "locator-drift": "Run repair mode (Mission #2): the behavior looks intact, only a selector broke. Re-anchor the locator.",
  "behavior-regression": "Likely a real bug: observed behavior differs from the expected value. Check against the ticket and file a finding — do NOT edit the test.",
  unknown: "Inspect manually — the failure did not match a known signature.",
};

/**
 * Pure: classify a single failing run's Playwright output.
 *
 * An assertion mismatch (Expected/Received) means the element was found but its
 * value was wrong → behavior regression. Otherwise a locator/timeout signature
 * means the element wasn't found → the UI drifted. Note: an `expect(locator)`
 * that times out on a MISSING element can print Expected/Received too; we treat
 * the presence of both as a behavior signal, a known and acceptable edge.
 */
export function classifyFailure(output: string): { class: FailureClass; evidence: string } {
  if (/Expected:/.test(output) && /Received:/.test(output)) {
    const expected = output.match(/Expected:\s*(.+)/)?.[1]?.trim() ?? "?";
    const received = output.match(/Received:\s*(.+)/)?.[1]?.trim() ?? "?";
    return { class: "behavior-regression", evidence: `Assertion mismatch — expected ${expected}, received ${received}.` };
  }
  for (const re of LOCATOR_SIGNALS) {
    const match = output.match(re);
    if (match) return { class: "locator-drift", evidence: `Locator failure: "${match[0].trim()}".` };
  }
  return { class: "unknown", evidence: "Failure did not match a known signature." };
}

/** Run the spec `reruns` times, then classify the outcome. Runner is injectable. */
export async function triageSpec(specFile: string, reruns: number, runner: TestRunner): Promise<Triage> {
  const spec = path.basename(specFile);
  const runs: TestRunResult[] = [];
  for (let i = 0; i < reruns; i++) runs.push(await runner(specFile));

  const passes = runs.filter((r) => r.passed).length;
  if (passes === runs.length) {
    return { spec, class: "passing", evidence: `Passed all ${runs.length} runs.`, recommendation: RECOMMENDATION.passing };
  }
  if (passes > 0) {
    return { spec, class: "flaky", evidence: `Passed ${passes}/${runs.length} runs.`, recommendation: RECOMMENDATION.flaky };
  }
  const failing = runs.find((r) => !r.passed) as TestRunResult;
  const { class: cls, evidence } = classifyFailure(failing.output);
  return { spec, class: cls, evidence, recommendation: RECOMMENDATION[cls] };
}

export function makeTriageRunner(repoPath: string, timeoutMs: number): TestRunner {
  return playwrightRunner(repoPath, timeoutMs);
}
