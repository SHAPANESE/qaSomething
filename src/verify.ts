import { execa } from "execa";
import path from "node:path";

/**
 * Harness-enforced trust gates. The agent's word is not evidence — these run
 * the produced tests and decide, mechanically, whether a test is trustworthy.
 *
 * Two gates:
 *  - Quarantine: run the test N times; it must pass every time (no flake).
 *  - Mutation polarity: a sibling `*.mutation.spec.ts` breaks the behavior via
 *    Playwright network interception (no app-source edit). The real test must
 *    PASS and the mutation test must FAIL. If the mutation still passes, the
 *    assertions don't verify real behavior → reject.
 */

export interface TestRunResult {
  passed: boolean;
  exitCode: number | null;
  passedCount: number;
  failedCount: number;
  output: string;
  /** True when the run couldn't execute (app/Playwright not runnable) — NOT a test failure. */
  inconclusive?: boolean;
}

const INCONCLUSIVE_SIGNALS: RegExp[] = [
  /no tests found/i,
  /Executable doesn't exist/i,
  /playwright install/i,
  /Timed out waiting \d+ms from config\.webServer/i,
  /web ?server.*exited early/i,
  /process from config\.webServer/i,
  /EADDRINUSE/i,
  /command not found/i,
  /Cannot find module/i,
];

/** Pure: does this output/exit look like an environment failure, not a test failure? */
export function looksInconclusive(output: string, exitCode: number | null): boolean {
  if (exitCode === 127) return true;
  return INCONCLUSIVE_SIGNALS.some((re) => re.test(output));
}

/** Signature so the runner can be faked in tests and swapped for CI. */
export type TestRunner = (specFile: string) => Promise<TestRunResult>;

const COUNT_RE = (label: string) => new RegExp(`(\\d+)\\s+${label}`, "i");

/** Pure: turn a raw Playwright process result into a structured verdict. */
export function interpretRun(exitCode: number | null, output: string): TestRunResult {
  const passedMatch = output.match(COUNT_RE("passed"));
  const failedMatch = output.match(COUNT_RE("failed"));
  const passedCount = passedMatch ? Number.parseInt(passedMatch[1] ?? "0", 10) : 0;
  const failedCount = failedMatch ? Number.parseInt(failedMatch[1] ?? "0", 10) : 0;
  const inconclusive = looksInconclusive(output, exitCode);
  return {
    passed: exitCode === 0 && failedCount === 0 && !inconclusive,
    exitCode,
    passedCount,
    failedCount,
    output,
    ...(inconclusive ? { inconclusive: true } : {}),
  };
}

export type Stability =
  | { kind: "stable-pass" }
  | { kind: "failing" }
  | { kind: "flaky"; passes: number; runs: number }
  | { kind: "inconclusive" };

/** Pure: aggregate N quarantine runs into a stability verdict. */
export function aggregateStability(runs: TestRunResult[]): Stability {
  // An environment failure isn't a test failure — surface it distinctly so the
  // gate doesn't blame the test (and the user) for a broken setup.
  if (runs.some((r) => r.inconclusive === true)) return { kind: "inconclusive" };
  const passes = runs.filter((r) => r.passed).length;
  if (passes === runs.length) return { kind: "stable-pass" };
  if (passes === 0) return { kind: "failing" };
  return { kind: "flaky", passes, runs: runs.length };
}

export type MutationVerdict =
  | { kind: "meaningful" }
  | { kind: "baseline-broken" }
  | { kind: "not-meaningful" }
  | { kind: "no-mutation-proof" };

/** Pure: check real→pass / mutation→fail polarity. */
export function checkMutationPolarity(real: Stability, mutation: TestRunResult | null): MutationVerdict {
  if (real.kind !== "stable-pass") return { kind: "baseline-broken" };
  if (mutation === null) return { kind: "no-mutation-proof" };
  return mutation.passed ? { kind: "not-meaningful" } : { kind: "meaningful" };
}

export interface TestVerdict {
  spec: string;
  stability: Stability;
  mutation: MutationVerdict;
  /** True only when the test is stable-pass AND its mutation proof goes red. */
  trusted: boolean;
  reasons: string[];
}

export function decideVerdict(spec: string, stability: Stability, mutation: MutationVerdict): TestVerdict {
  const reasons: string[] = [];
  if (stability.kind === "inconclusive")
    reasons.push(
      "Could not run — the app or Playwright is not runnable (an environment problem, NOT a test failure). Fix the setup, then re-verify.",
    );
  if (stability.kind === "failing") reasons.push("Test fails on a clean run.");
  if (stability.kind === "flaky") reasons.push(`Flaky: passed ${stability.passes}/${stability.runs} runs.`);
  if (mutation.kind === "not-meaningful")
    reasons.push("Mutation proof still passes — assertions don't verify real behavior.");
  if (mutation.kind === "no-mutation-proof")
    reasons.push("No *.mutation.spec.ts sibling — cannot prove the test catches a bug.");
  const trusted = stability.kind === "stable-pass" && mutation.kind === "meaningful";
  if (trusted) reasons.push("Stable pass and the mutation proof goes red — trustworthy.");
  return { spec, stability, mutation, trusted, reasons };
}

/**
 * Orchestrate the gates for one spec. `runner` is injected so this is testable
 * without a browser and swappable for a CI runner.
 */
export async function verifySpec(
  spec: string,
  mutationSpec: string | null,
  reruns: number,
  runner: TestRunner,
): Promise<TestVerdict> {
  const runs: TestRunResult[] = [];
  for (let i = 0; i < reruns; i++) {
    runs.push(await runner(spec));
  }
  const stability = aggregateStability(runs);

  let mutation: TestRunResult | null = null;
  // Only spend a mutation run if the baseline is solid.
  if (stability.kind === "stable-pass" && mutationSpec !== null) {
    mutation = await runner(mutationSpec);
  }
  const mutationVerdict = checkMutationPolarity(stability, mutationSpec === null ? null : mutation);
  return decideVerdict(spec, stability, mutationVerdict);
}

export interface VerdictJson {
  spec: string;
  trusted: boolean;
  stability: string;
  mutation: string;
  reasons: string[];
}

/** Pure: a machine-readable shape for CI to consume. */
export function verdictToJson(v: TestVerdict): VerdictJson {
  return {
    spec: v.spec,
    trusted: v.trusted,
    stability: v.stability.kind,
    mutation: v.mutation.kind,
    reasons: v.reasons,
  };
}

export interface SpecPair {
  spec: string;
  mutation: string | null;
}

const MUTATION_SUFFIX = ".mutation.spec.ts";
const SPEC_SUFFIX = ".spec.ts";

/** Pure: pair each real spec with its `*.mutation.spec.ts` sibling, if present. */
export function pairSpecs(paths: string[]): SpecPair[] {
  const set = new Set(paths.map((p) => p.split("\\").join("/")));
  const pairs: SpecPair[] = [];
  for (const p of set) {
    if (p.endsWith(MUTATION_SUFFIX)) continue;
    if (!p.endsWith(SPEC_SUFFIX)) continue;
    const sibling = p.slice(0, -SPEC_SUFFIX.length) + MUTATION_SUFFIX;
    pairs.push({ spec: p, mutation: set.has(sibling) ? sibling : null });
  }
  return pairs;
}

/** Verify every produced real spec, pairing each with its mutation proof. */
export async function verifyAll(
  specFiles: string[],
  reruns: number,
  runner: TestRunner,
): Promise<TestVerdict[]> {
  const pairs = pairSpecs(specFiles);
  const verdicts: TestVerdict[] = [];
  for (const pair of pairs) {
    verdicts.push(await verifySpec(pair.spec, pair.mutation, reruns, runner));
  }
  return verdicts;
}

/**
 * Default runner: run the repo's local Playwright CLI as `playwright test <spec>`.
 *
 * The spec path is passed as a SEPARATE ARGV, never interpolated into a shell
 * string — a test filename with shell metacharacters (from an untrusted repo)
 * cannot inject commands. `preferLocal` resolves the repo's own Playwright binary
 * and handles Windows `.cmd` resolution, so no shell is needed at all.
 */
export function playwrightRunner(repoPath: string, timeoutMs: number): TestRunner {
  return async (specFile) => {
    const rel = path.relative(repoPath, specFile).split(path.sep).join("/") || specFile;
    const res = await execa("playwright", ["test", rel, "--reporter=line"], {
      cwd: repoPath,
      timeout: timeoutMs,
      reject: false,
      preferLocal: true,
      localDir: repoPath,
    });
    const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    return interpretRun(typeof res.exitCode === "number" ? res.exitCode : null, output);
  };
}
