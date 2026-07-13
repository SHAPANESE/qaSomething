import type { TestCase } from "./cases.js";
import type { Coverage } from "./run.js";

/**
 * Render the sign-off summary from the whole casebook: coverage, which cases are
 * covered by trusted (passing) tests, which produced bugs, what is NOT covered and
 * the spec gaps found. Honest about the discard — that is part of the criterio.
 */

export interface ReportInput {
  ticketId: string;
  date: string;
  cases: TestCase[];
  coverage: Coverage;
  gaps: string;
  findings: string[];
}

function line(c: TestCase): string {
  return `- \`${c.id}\` (${c.category}) — ${c.ac}`;
}

export function renderReport(input: ReportInput): string {
  const { ticketId, date, cases, coverage: cov, gaps, findings } = input;
  const passing = cases.filter((c) => c.status === "passing");
  const bugs = cases.filter((c) => c.status === "bug");
  const notCovered = cases.filter(
    (c) =>
      c.status === "planned" || c.status === "authored" || c.status === "failing" || c.status === "flaky",
  );

  const parts: string[] = [];
  parts.push(`# QA sign-off — ${ticketId}`);
  parts.push(`\n_Generated ${date}._\n`);
  parts.push(`## Coverage\n`);
  parts.push(
    `${cov.passing}/${cov.total} cases covered by trusted tests (**${cov.coveredPct}%**). ` +
      `planned ${cov.planned} · authored ${cov.authored} · passing ${cov.passing} · failing ${cov.failing} · flaky ${cov.flaky} · bug ${cov.bug}.`,
  );
  parts.push(`\n## Covered by trusted tests\n`);
  parts.push(passing.length ? passing.map(line).join("\n") : "_none yet_");
  parts.push(`\n## Bugs found\n`);
  parts.push(bugs.length ? bugs.map(line).join("\n") : "_none_");
  if (findings.length) parts.push(`\nFindings: ${findings.map((f) => `\`${f}\``).join(", ")}`);
  parts.push(`\n## NOT covered (and why to look)\n`);
  parts.push(notCovered.length ? notCovered.map(line).join("\n") : "_everything prioritized is covered_");
  parts.push(`\n## Spec gaps\n`);
  parts.push(gaps.trim() ? gaps.trim() : "_none flagged_");
  return parts.join("\n") + "\n";
}
