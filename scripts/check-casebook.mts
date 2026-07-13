/**
 * Validate a produced casebook: it must parse, and it must show real criterio —
 * more than one scenario category and, unless the ticket is trivially covered,
 * at least one non-happy case. Exits non-zero with a reason otherwise.
 *
 * Usage: pnpm tsx scripts/check-casebook.mts <repoPath>
 */
import { existsSync } from "node:fs";
import { readCases, casebookPaths } from "../src/casebook/store.js";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: check-casebook <repoPath>");
  process.exit(2);
}

const paths = casebookPaths(repo);
const problems: string[] = [];

const cases = await readCases(repo);
if (cases.length === 0) problems.push("no cases parsed from .qa-agent/cases.md");

const categories = new Set(cases.map((c) => c.category));
if (categories.size < 2) problems.push(`only one scenario category present (${[...categories].join(", ")})`);

const nonHappy = cases.filter((c) => c.category !== "happy");
if (nonHappy.length === 0)
  problems.push("no non-happy cases — criterio not exercised (negatives/boundaries?)");

if (!existsSync(paths.gaps)) problems.push("no gaps.md — spec was not questioned");

if (problems.length > 0) {
  console.error("✗ casebook check FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ casebook check passed: ${cases.length} cases, categories: ${[...categories].join(", ")}`);
