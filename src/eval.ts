import { existsSync } from "node:fs";
import path from "node:path";
import { playwrightRunner, verifyAll, type TestRunner, type TestVerdict } from "./verify.js";

/**
 * The eval harness: "QA of the QA". It runs the trust gates over a labeled set
 * of tests whose correct verdict we already know, and scores whether the gates
 * classified them right. This is how we measure and improve the agent/gates
 * with data instead of vibes — the scarce "QA of AI" skill, made concrete.
 */

export type ExpectedVerdict = "trusted" | "rejected";

export interface EvalCase {
  /** Repo-relative path to the real spec. */
  spec: string;
  expected: ExpectedVerdict;
  note?: string;
}

export interface EvalResult {
  spec: string;
  expected: ExpectedVerdict;
  actual: ExpectedVerdict;
  correct: boolean;
  reasons: string[];
}

export interface EvalReport {
  results: EvalResult[];
  passed: number;
  total: number;
  score: number;
}

const norm = (s: string): string => s.split("\\").join("/");

/** Pure: compare expected vs actual verdicts and score. */
export function scoreEvals(cases: EvalCase[], verdicts: TestVerdict[]): EvalReport {
  const results: EvalResult[] = cases.map((c) => {
    const verdict = verdicts.find((v) => norm(v.spec).endsWith(norm(c.spec)));
    const actual: ExpectedVerdict = verdict?.trusted ? "trusted" : "rejected";
    return {
      spec: c.spec,
      expected: c.expected,
      actual,
      correct: verdict !== undefined && actual === c.expected,
      reasons: verdict?.reasons ?? ["No verdict produced for this spec."],
    };
  });
  const passed = results.filter((r) => r.correct).length;
  return { results, passed, total: results.length, score: results.length ? passed / results.length : 0 };
}

/** Run the gates over the eval set and score. Runner is injectable for testing. */
export async function runEvals(
  repoPath: string,
  cases: EvalCase[],
  reruns: number,
  runner?: TestRunner,
): Promise<EvalReport> {
  const actualRunner = runner ?? playwrightRunner(repoPath, 120_000);
  const specFiles: string[] = [];
  for (const c of cases) {
    const abs = path.join(repoPath, c.spec);
    specFiles.push(abs);
    const mutation = abs.replace(/\.spec\.ts$/, ".mutation.spec.ts");
    // Only include a mutation proof that actually exists, so a missing proof is
    // correctly treated as "no-mutation-proof" rather than a spurious pass.
    if (existsSync(mutation)) specFiles.push(mutation);
  }
  const verdicts = await verifyAll(specFiles, reruns, actualRunner);
  return scoreEvals(cases, verdicts);
}
