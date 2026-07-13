/**
 * Read the `// case: TC-<TICKET>-NN` tag that qa-author writes as a spec's first
 * line. This is what re-links a spec back to its case for run/triage/report.
 */

const CASE_TAG_RE = /^\/\/\s*case:\s*(TC-[A-Za-z0-9-]+-\d{2,})\b/m;

export function parseCaseTag(specText: string): string | null {
  const m = specText.match(CASE_TAG_RE);
  return m ? m[1]! : null;
}
