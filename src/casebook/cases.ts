import { z } from "zod";

/**
 * A test case — the traceability + criterio unit of the casebook. Each case
 * records not just what it tests but WHICH scenario category it covers, so the
 * planning judgment (did it consider negatives, boundaries, …?) is auditable.
 *
 * On-disk format (`cases.md`): one frontmatter block per case, followed by a
 * human-readable description, repeated. A description must not contain a lone
 * `---` line (that delimiter starts the next block).
 */

export const SCENARIO_CATEGORIES = [
  "happy",
  "negative",
  "boundary",
  "state",
  "concurrency",
  "idempotency",
  "data-integrity",
  "interruption",
  "security",
  "a11y",
  "performance",
  "compatibility",
  "i18n",
] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

export const CASE_STATUSES = ["planned", "authored", "passing", "failing", "flaky", "bug"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PRIORITIES = ["high", "medium", "low"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const TestCaseSchema = z
  .object({
    id: z.string().regex(/^TC-.+-\d{2,}$/),
    ac: z.string().min(1),
    priority: z.enum(CASE_PRIORITIES),
    category: z.enum(SCENARIO_CATEGORIES),
    status: z.enum(CASE_STATUSES),
    spec: z.string().min(1).optional(),
    description: z.string(),
  })
  .strict();
export type TestCase = z.infer<typeof TestCaseSchema>;

// A case block: `---\n<frontmatter>\n---\n<body up to the next block or EOF>`.
const BLOCK_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*?)(?=\n---[ \t]*\n|$(?![\s\S]))/gm;

function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function parseCases(md: string): TestCase[] {
  md = md.replace(/\r\n/g, "\n");
  const cases: TestCase[] = [];
  for (const match of md.matchAll(BLOCK_RE)) {
    const fm = parseFrontmatter(match[1] ?? "");
    const description = (match[2] ?? "").trim();
    const candidate: Record<string, string> = { ...fm, description };
    if (!candidate["spec"]) delete candidate["spec"];
    cases.push(TestCaseSchema.parse(candidate));
  }
  return cases;
}

function quoteIfNeeded(value: string): string {
  return /[:#"]|^\s|\s$/.test(value) ? `"${value}"` : value;
}

export function serializeCases(cases: TestCase[]): string {
  return cases
    .map((c) => {
      const lines = [
        `id: ${c.id}`,
        `ac: ${quoteIfNeeded(c.ac)}`,
        `priority: ${c.priority}`,
        `category: ${c.category}`,
        `status: ${c.status}`,
        ...(c.spec ? [`spec: ${c.spec}`] : []),
      ];
      return `---\n${lines.join("\n")}\n---\n${c.description}\n`;
    })
    .join("\n");
}
