/**
 * Run an eval file: score whether the trust gates classify a labeled test set
 * correctly. Usage: tsx scripts/run-evals.mts [evals/login-app.eval.json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runEvals, type EvalCase } from "../src/eval.js";

const evalFile = process.argv[2] ?? "evals/login-app.eval.json";
const spec = JSON.parse(await readFile(evalFile, "utf8")) as {
  repo: string;
  reruns: number;
  cases: EvalCase[];
};

const repo = path.resolve(spec.repo);
console.log(`Eval: ${evalFile}\nRepo: ${repo}\nCases: ${spec.cases.length} · reruns ×${spec.reruns}\n`);

const report = await runEvals(repo, spec.cases, spec.reruns);

console.log("═".repeat(64));
for (const r of report.results) {
  const mark = r.correct ? "✓" : "✗";
  console.log(`${mark} ${r.spec}`);
  console.log(`    expected=${r.expected}  actual=${r.actual}`);
  if (!r.correct) for (const reason of r.reasons) console.log(`    · ${reason}`);
}
console.log("═".repeat(64));
console.log(`SCORE: ${report.passed}/${report.total}  (${Math.round(report.score * 100)}%)`);
if (report.score < 1) process.exitCode = 1;
