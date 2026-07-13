# QA Sidekick — Back-of-Cycle (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the QA cycle by building the back-of-cycle stages — `qa-run`, `qa-triage`, `qa-bug`, `qa-report` — on top of the Plan 1 casebook, so a ticket can go plan → author → run → triage → bug → report end to end inside Claude Code.

**Architecture:** Extend the `src/casebook/` module with the run/flaky/findings artifacts and the pure logic they need (link a spec to its case via its `// case:` tag, model a run record, compute coverage, render a sign-off report). Then add four stage-skills that call the existing engine (`src/verify.ts` runners/verdicts, `src/triage.ts` `classifyFailure`) as deterministic hands and read/write the casebook. Stages stay stateless; the casebook holds state.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` imports, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`), zod, vitest, Claude Code skills. No new runtime dependencies.

## Global Constraints

- **Language/module:** TypeScript `module: NodeNext`. Relative imports MUST use `.js`. Type-only imports use `import type` (`verbatimModuleSyntax`).
- **`exactOptionalPropertyTypes` on:** never assign `undefined` to an optional property — omit the key. (Relevant to the optional `caseId`.)
- **`noUncheckedIndexedAccess` on:** guard index access; `!` only when provably present.
- **Validation:** all parsed external data validated with `zod` `.strict()`, mirroring `src/casebook/state.ts`.
- **Tests:** vitest; `import { describe, expect, it } from "vitest";`. Tests next to source as `*.test.ts`.
- **Casebook lives at** `.qa-agent/` (write-guard allowlisted). New artifacts: `runs/<date>.json`, `flaky.json`, `findings/*.md`. Filenames must be Windows-safe (no `:` — sanitize dates).
- **Case-ID format:** `TC-<TICKET>-NN`. Specs carry their case id as a first-line comment `// case: TC-<TICKET>-NN`.
- **Cycle phases (already defined in `state.ts`):** planned → authored → run → triaged → reported.
- **Case statuses (already in `cases.ts`):** planned | authored | passing | failing | flaky | bug.
- **App source read-only** in skills: write only under `tests/`, `reports/`, `.qa-agent/`.
- **Gate before every commit:** `pnpm check` must pass. **Commits:** Conventional Commits.
- **`.claude/skills/` is prettier-ignored** (Plan 1 decision) — skill markdown is not format-checked.

## Reused engine interfaces (do not reimplement)

```ts
// src/verify.ts
interface TestRunResult { passed: boolean; inconclusive: boolean; output: string; exitCode: number | null }
type TestRunner = (specFile: string) => Promise<TestRunResult>
function interpretRun(exitCode: number | null, output: string): TestRunResult
function playwrightRunner(repoPath: string, timeoutMs: number): TestRunner
type Stability = ...; function aggregateStability(runs: TestRunResult[]): Stability
interface SpecPair {...}; function pairSpecs(paths: string[]): SpecPair[]
// src/triage.ts
type FailureClass = "passing" | "flaky" | "locator-drift" | "behavior-regression" | "unknown"
function classifyFailure(output: string): { class: FailureClass; evidence: string }
// src/casebook/cases.ts
type TestCase = { id; ac; priority; category; status; spec?; description }
type CaseStatus = "planned"|"authored"|"passing"|"failing"|"flaky"|"bug"
function parseCases(md): TestCase[]; function serializeCases(cases): string
// src/casebook/store.ts
function casebookPaths(repo): { dir; plan; cases; gaps; state; runs; findings; flaky }
async readCases(repo); writeCases(repo, cases); ensureCasebook(repo)
```

---

## File Structure

**New (Plan 2):**

- `src/casebook/caseTag.ts` (+ test) — pure: read `// case:` tag from a spec's text.
- `src/casebook/run.ts` (+ test) — pure: run-record model + `computeCoverage`.
- `src/casebook/flaky.ts` (+ test) — pure: flaky-registry model + parse/serialize.
- `src/casebook/report.ts` (+ test) — pure: render the sign-off markdown.
- `.claude/skills/qa-run/SKILL.md`, `qa-triage/SKILL.md`, `qa-bug/SKILL.md`, `qa-report/SKILL.md`.

**Modified:**

- `src/casebook/cases.ts` (+ test) — add pure `updateCase(cases, id, patch)` helper.
- `src/casebook/store.ts` (+ test) — add run/flaky/findings/gaps I/O.
- `.claude/skills/qa/SKILL.md` — flip the four stages from "Plan 2" to built.
- `README.md`, `CHANGELOG.md`.

**Interface summary (locked here):**

```ts
// caseTag.ts
parseCaseTag(specText: string): string | null
// run.ts
type CaseOutcome = "pass" | "fail" | "inconclusive"
interface CaseRunResult { spec: string; caseId?: string; outcome: CaseOutcome }
interface RunRecord { date: string; results: CaseRunResult[] }
parseRun(raw): RunRecord; serializeRun(r): string
interface Coverage { total; planned; authored; passing; failing; flaky; bug; coveredPct }
computeCoverage(cases: TestCase[]): Coverage
// flaky.ts
type FlakyClass = "flaky" | "locator-drift" | "behavior-regression" | "unknown"
interface FlakyEntry { spec: string; caseId?: string; class: FlakyClass; note: string; updated: string }
interface FlakyRegistry { version: 1; entries: FlakyEntry[] }
emptyFlaky(): FlakyRegistry; parseFlaky(raw): FlakyRegistry; serializeFlaky(r): string
upsertFlaky(reg, entry): FlakyRegistry
// report.ts
interface ReportInput { ticketId; date; cases; coverage; gaps; findings }
renderReport(input: ReportInput): string
// cases.ts (added)
updateCase(cases: TestCase[], id: string, patch: Partial<TestCase>): TestCase[]
// store.ts (added)
runPath(repo, date): string
writeRun(repo, record): Promise<void>; readLatestRun(repo): Promise<RunRecord | null>
readFlaky(repo): Promise<FlakyRegistry>; writeFlaky(repo, reg): Promise<void>
readGaps(repo): Promise<string>
listFindings(repo): Promise<string[]>; writeFinding(repo, name, md): Promise<void>
```

---

### Task 1: Case-tag parsing (`src/casebook/caseTag.ts`)

**Files:** Create `src/casebook/caseTag.ts`, `src/casebook/caseTag.test.ts`.

**Interfaces:** Produces `parseCaseTag(specText): string | null`.

- [ ] **Step 1: Write the failing test** — `src/casebook/caseTag.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCaseTag } from "./caseTag.js";

describe("parseCaseTag", () => {
  it("reads the case id from a leading // case: comment", () => {
    expect(parseCaseTag("// case: TC-PROJ-42-04\nimport { test } from '@playwright/test';")).toBe(
      "TC-PROJ-42-04",
    );
  });
  it("tolerates extra spacing", () => {
    expect(parseCaseTag("//   case:   TC-X-01")).toBe("TC-X-01");
  });
  it("returns null when there is no tag", () => {
    expect(parseCaseTag("import { test } from '@playwright/test';")).toBeNull();
  });
  it("only matches a well-formed id", () => {
    expect(parseCaseTag("// case: nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/casebook/caseTag.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** — `src/casebook/caseTag.ts`:

```ts
/**
 * Read the `// case: TC-<TICKET>-NN` tag that qa-author writes as a spec's first
 * line. This is what re-links a spec back to its case for run/triage/report.
 */

const CASE_TAG_RE = /^\/\/\s*case:\s*(TC-[A-Za-z0-9-]+-\d{2,})\b/m;

export function parseCaseTag(specText: string): string | null {
  const m = specText.match(CASE_TAG_RE);
  return m ? m[1]! : null;
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/casebook/caseTag.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/caseTag.ts src/casebook/caseTag.test.ts
git commit -m "feat(casebook): parse the // case: tag linking a spec to its case"
```

---

### Task 2: Run-record model + coverage (`src/casebook/run.ts`)

**Files:** Create `src/casebook/run.ts`, `src/casebook/run.test.ts`.

**Interfaces:** Consumes `TestCase`, `CaseStatus` from `./cases.js`. Produces `CaseOutcome`, `CaseRunResult`, `RunRecord`, `parseRun`, `serializeRun`, `Coverage`, `computeCoverage`.

- [ ] **Step 1: Write the failing test** — `src/casebook/run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeCoverage, parseRun, serializeRun, type RunRecord } from "./run.js";
import type { TestCase } from "./cases.js";

const mk = (id: string, status: TestCase["status"]): TestCase => ({
  id,
  ac: "ac",
  priority: "high",
  category: "happy",
  status,
  description: "d",
});

describe("parseRun / serializeRun", () => {
  it("round-trips a run record", () => {
    const r: RunRecord = {
      date: "2026-07-13T00:00:00.000Z",
      results: [
        { spec: "tests/a.spec.ts", caseId: "TC-X-01", outcome: "pass" },
        { spec: "tests/b.spec.ts", outcome: "fail" },
      ],
    };
    expect(parseRun(serializeRun(r))).toEqual(r);
  });
  it("rejects an unknown outcome", () => {
    const raw = JSON.stringify({ date: "d", results: [{ spec: "s", outcome: "boom" }] });
    expect(() => parseRun(raw)).toThrow();
  });
});

describe("computeCoverage", () => {
  it("counts statuses and computes covered percentage from passing/total", () => {
    const cases = [
      mk("TC-X-01", "passing"),
      mk("TC-X-02", "failing"),
      mk("TC-X-03", "passing"),
      mk("TC-X-04", "planned"),
    ];
    const cov = computeCoverage(cases);
    expect(cov).toEqual({
      total: 4,
      planned: 1,
      authored: 0,
      passing: 2,
      failing: 1,
      flaky: 0,
      bug: 0,
      coveredPct: 50,
    });
  });
  it("is zero-safe for an empty casebook", () => {
    expect(computeCoverage([]).coveredPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/casebook/run.test.ts` → FAIL.

- [ ] **Step 3: Write minimal implementation** — `src/casebook/run.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/casebook/run.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/run.ts src/casebook/run.test.ts
git commit -m "feat(casebook): run-record model + coverage-vs-plan"
```

---

### Task 3: Flaky registry (`src/casebook/flaky.ts`)

**Files:** Create `src/casebook/flaky.ts`, `src/casebook/flaky.test.ts`.

**Interfaces:** Produces `FlakyClass`, `FlakyEntry`, `FlakyRegistry`, `emptyFlaky`, `parseFlaky`, `serializeFlaky`, `upsertFlaky`.

- [ ] **Step 1: Write the failing test** — `src/casebook/flaky.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyFlaky, parseFlaky, serializeFlaky, upsertFlaky } from "./flaky.js";

describe("parseFlaky / serializeFlaky", () => {
  it("round-trips", () => {
    const reg = upsertFlaky(emptyFlaky(), {
      spec: "tests/a.spec.ts",
      caseId: "TC-X-01",
      class: "flaky",
      note: "2/3 runs failed",
      updated: "2026-07-13T00:00:00.000Z",
    });
    expect(parseFlaky(serializeFlaky(reg))).toEqual(reg);
  });
  it("rejects an unknown class", () => {
    const raw = JSON.stringify({
      version: 1,
      entries: [{ spec: "s", class: "boom", note: "", updated: "t" }],
    });
    expect(() => parseFlaky(raw)).toThrow();
  });
});

describe("upsertFlaky", () => {
  it("replaces an existing entry for the same spec instead of duplicating", () => {
    let reg = upsertFlaky(emptyFlaky(), {
      spec: "tests/a.spec.ts",
      class: "flaky",
      note: "a",
      updated: "t1",
    });
    reg = upsertFlaky(reg, { spec: "tests/a.spec.ts", class: "locator-drift", note: "b", updated: "t2" });
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0]!.class).toBe("locator-drift");
    expect(reg.entries[0]!.note).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/casebook/flaky.test.ts` → FAIL.

- [ ] **Step 3: Write minimal implementation** — `src/casebook/flaky.ts`:

```ts
import { z } from "zod";

/**
 * The flaky/failure registry (`.qa-agent/flaky.json`): what qa-triage learned
 * about specs that don't cleanly pass — flaky, drifted locators, or a real
 * behavior regression. One entry per spec (latest wins).
 */

export const FLAKY_CLASSES = ["flaky", "locator-drift", "behavior-regression", "unknown"] as const;
export type FlakyClass = (typeof FLAKY_CLASSES)[number];

export const FlakyEntrySchema = z
  .object({
    spec: z.string().min(1),
    caseId: z.string().optional(),
    class: z.enum(FLAKY_CLASSES),
    note: z.string(),
    updated: z.string().min(1),
  })
  .strict();
export type FlakyEntry = z.infer<typeof FlakyEntrySchema>;

export const FlakyRegistrySchema = z
  .object({
    version: z.literal(1),
    entries: z.array(FlakyEntrySchema),
  })
  .strict();
export type FlakyRegistry = z.infer<typeof FlakyRegistrySchema>;

export function emptyFlaky(): FlakyRegistry {
  return { version: 1, entries: [] };
}

export function parseFlaky(raw: string): FlakyRegistry {
  return FlakyRegistrySchema.parse(JSON.parse(raw));
}

export function serializeFlaky(reg: FlakyRegistry): string {
  return JSON.stringify(reg, null, 2) + "\n";
}

/** Insert or replace the entry for a spec (latest wins), returning a new registry. */
export function upsertFlaky(reg: FlakyRegistry, entry: FlakyEntry): FlakyRegistry {
  const entries = reg.entries.filter((e) => e.spec !== entry.spec);
  entries.push(entry);
  return { ...reg, entries };
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/casebook/flaky.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/flaky.ts src/casebook/flaky.test.ts
git commit -m "feat(casebook): flaky/failure registry model"
```

---

### Task 4: Sign-off report renderer (`src/casebook/report.ts`)

**Files:** Create `src/casebook/report.ts`, `src/casebook/report.test.ts`.

**Interfaces:** Consumes `TestCase` from `./cases.js`, `Coverage` from `./run.js`. Produces `ReportInput`, `renderReport`.

- [ ] **Step 1: Write the failing test** — `src/casebook/report.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/casebook/report.test.ts` → FAIL.

- [ ] **Step 3: Write minimal implementation** — `src/casebook/report.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/casebook/report.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/report.ts src/casebook/report.test.ts
git commit -m "feat(casebook): sign-off report renderer"
```

---

### Task 5: Casebook I/O for runs/flaky/findings/gaps + `updateCase` (`store.ts`, `cases.ts`)

**Files:** Modify `src/casebook/cases.ts` (+ `cases.test.ts`), `src/casebook/store.ts` (+ `store.test.ts`).

**Interfaces:** Adds `updateCase` (cases.ts); `runPath`, `writeRun`, `readLatestRun`, `readFlaky`, `writeFlaky`, `readGaps`, `listFindings`, `writeFinding` (store.ts). Consumes `run.ts` and `flaky.ts`.

- [ ] **Step 1: Write the failing test (cases.ts helper)** — append to `src/casebook/cases.test.ts`:

```ts
import { updateCase } from "./cases.js";

describe("updateCase", () => {
  const base = [sample[0]!, sample[1]!]; // reuse the file's existing `sample`
  it("patches one case by id without mutating the input", () => {
    const out = updateCase(base, base[0]!.id, { status: "passing", spec: "tests/x.spec.ts" });
    expect(out[0]!.status).toBe("passing");
    expect(out[0]!.spec).toBe("tests/x.spec.ts");
    expect(base[0]!.status).toBe("planned"); // input untouched
  });
  it("returns the array unchanged when the id is absent", () => {
    expect(updateCase(base, "TC-NOPE-99", { status: "bug" })).toEqual(base);
  });
});
```

(If the file's existing `sample` is not module-scoped, hoist it or inline two `TestCase` literals with `status: "planned"`.)

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run src/casebook/cases.test.ts` → FAIL (`updateCase` not exported).

- [ ] **Step 3: Implement `updateCase`** — add to `src/casebook/cases.ts` (after `serializeCases`):

```ts
/** Pure: patch one case by id, returning a new array (input untouched). */
export function updateCase(cases: TestCase[], id: string, patch: Partial<TestCase>): TestCase[] {
  return cases.map((c) => (c.id === id ? { ...c, ...patch } : c));
}
```

- [ ] **Step 4: Run → PASS** — `pnpm vitest run src/casebook/cases.test.ts` → PASS.

- [ ] **Step 5: Write the failing test (store I/O)** — append to `src/casebook/store.test.ts` (reuses the file's existing `mkdtemp`/`repo`/`afterEach` harness):

```ts
import { emptyFlaky, upsertFlaky } from "./flaky.js";
import {
  listFindings,
  readFlaky,
  readGaps,
  readLatestRun,
  writeFinding,
  writeFlaky,
  writeRun,
} from "./store.js";
import type { RunRecord } from "./run.js";

describe("run I/O", () => {
  it("writes a run and reads the latest back (date colons sanitized in the filename)", async () => {
    const r: RunRecord = {
      date: "2026-07-13T09:00:00.000Z",
      results: [{ spec: "tests/a.spec.ts", outcome: "pass" }],
    };
    await writeRun(repo, r);
    expect(await readLatestRun(repo)).toEqual(r);
  });
  it("returns null when there are no runs", async () => {
    expect(await readLatestRun(repo)).toBeNull();
  });
});

describe("flaky I/O", () => {
  it("defaults to empty then round-trips", async () => {
    expect(await readFlaky(repo)).toEqual(emptyFlaky());
    const reg = upsertFlaky(emptyFlaky(), { spec: "s", class: "flaky", note: "n", updated: "t" });
    await writeFlaky(repo, reg);
    expect(await readFlaky(repo)).toEqual(reg);
  });
});

describe("gaps + findings I/O", () => {
  it("reads gaps ('' when none) and lists written findings", async () => {
    expect(await readGaps(repo)).toBe("");
    await writeFinding(repo, "PROJ-42-bug-1.md", "# Bug\nrepro...");
    expect(await listFindings(repo)).toEqual(["PROJ-42-bug-1.md"]);
  });
});
```

- [ ] **Step 6: Run → FAIL** — `pnpm vitest run src/casebook/store.test.ts` → FAIL.

- [ ] **Step 7: Implement store I/O** — add to `src/casebook/store.ts` (imports at top, helpers at bottom):

```ts
// add to the existing node:fs/promises import: readdir
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseRun, serializeRun, type RunRecord } from "./run.js";
import { emptyFlaky, parseFlaky, serializeFlaky, type FlakyRegistry } from "./flaky.js";
```

```ts
/** Filename-safe path for a run record (Windows forbids ':'). */
export function runPath(repo: string, date: string): string {
  return path.join(casebookPaths(repo).runs, `${date.replace(/[:.]/g, "-")}.json`);
}

export async function writeRun(repo: string, record: RunRecord): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(runPath(repo, record.date), serializeRun(record), "utf8");
}

export async function readLatestRun(repo: string): Promise<RunRecord | null> {
  const dir = casebookPaths(repo).runs;
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const last = files.at(-1);
  if (!last) return null;
  return parseRun(await readFile(path.join(dir, last), "utf8"));
}

export async function readFlaky(repo: string): Promise<FlakyRegistry> {
  const p = casebookPaths(repo).flaky;
  if (!existsSync(p)) return emptyFlaky();
  return parseFlaky(await readFile(p, "utf8"));
}

export async function writeFlaky(repo: string, reg: FlakyRegistry): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(casebookPaths(repo).flaky, serializeFlaky(reg), "utf8");
}

export async function readGaps(repo: string): Promise<string> {
  const p = casebookPaths(repo).gaps;
  return existsSync(p) ? readFile(p, "utf8") : "";
}

export async function listFindings(repo: string): Promise<string[]> {
  const dir = casebookPaths(repo).findings;
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
}

export async function writeFinding(repo: string, name: string, markdown: string): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(path.join(casebookPaths(repo).findings, name), markdown, "utf8");
}
```

(Note: `existsSync` and `path` are already imported in store.ts; add only `readdir` to the fs import and the two casebook-module imports. `readLatestRun` sorts filenames lexically — ISO-ish sanitized dates sort chronologically.)

- [ ] **Step 8: Run → PASS + full gate** — `pnpm vitest run src/casebook/store.test.ts` then `pnpm check` → all green.

- [ ] **Step 9: Commit**

```bash
git add src/casebook/cases.ts src/casebook/cases.test.ts src/casebook/store.ts src/casebook/store.test.ts
git commit -m "feat(casebook): run/flaky/findings/gaps I/O + updateCase helper"
```

---

### Task 6: `qa-run` skill + dogfood

**Files:** Create `.claude/skills/qa-run/SKILL.md`. Dogfood updates `fixtures/login-app/.qa-agent/`.

- [ ] **Step 1: Author the skill** — `.claude/skills/qa-run/SKILL.md`:

```markdown
---
name: qa-run
description: Use to run the authored Playwright tests, map each result back to its case, record the run, and update coverage vs the plan. Triggers on "run the tests", "run the suite", "what's the coverage", "did the tests pass".
---

# qa-run — run the tests, update the casebook

Runs the specs in the repo under test and records the outcome per case in the
casebook. It does NOT diagnose failures (that's qa-triage) or write tests (qa-author).

## Steps

1. Read `<repo>/.qa-agent/cases.md`. Determine the specs to run (the `spec:` of each
   authored case; or all `tests/*.spec.ts` excluding `*.mutation.spec.ts`).
2. Run them. Prefer the engine's trust gate for authored cases:
   `node <qa-agent>/dist/index.js verify --repo <repo> --all --json` — it already
   pairs each spec with its mutation and returns TRUSTED/REJECTED per spec. Otherwise
   run Playwright directly (`npx playwright test`).
3. For each spec, read its first line to get the `// case: TC-...` tag → map the
   result to that case id.
4. Write a run record to `<repo>/.qa-agent/runs/<ISO-date>.json` in this shape:
   `{ "date": "<ISO8601>", "results": [ { "spec": "tests/x.spec.ts", "caseId": "TC-...", "outcome": "pass|fail|inconclusive" } ] }`
   (an ENV/setup failure — app won't start, browser missing — is `inconclusive`, NOT
   `fail`; don't blame the test for a broken environment).
5. Update each run case's `status` in `cases.md`: TRUSTED/pass → `passing`; a real
   failure → `failing`. Leave `inconclusive` as-is and say so.
6. Set this ticket's phase in `state.json` to `run`.
7. Report coverage: passing/total, and which cases are failing/uncovered.

## Rules

- App source READ-ONLY. Only write under `.qa-agent/` (and never edit a test to make
  it pass — that's qa-triage/qa-author's call).
- A REJECTED (hollow/flaky) spec is a failing/flaky case, not a pass.
```

- [ ] **Step 2: Dogfood** — build (`pnpm build`), then act as qa-run on `fixtures/login-app`: run the authored specs, write `fixtures/login-app/.qa-agent/runs/<date>.json`, flip the passing cases (e.g. TC-PROJ-42-01/-02/-04) to `status: passing` in `cases.md`, set state phase to `run`. Verify the casebook still parses:
      `pnpm tsx scripts/check-casebook.mts fixtures/login-app` → ✔.

- [ ] **Step 3: Gate + commit** — `pnpm check` green, then:

```bash
git add .claude/skills/qa-run/SKILL.md
git add -f fixtures/login-app/.qa-agent
git commit -m "feat(qa-run): run tests, record the run, update coverage"
```

---

### Task 7: `qa-triage` skill + dogfood

**Files:** Create `.claude/skills/qa-triage/SKILL.md`. Dogfood may update `fixtures/login-app/.qa-agent/flaky.json`.

- [ ] **Step 1: Author the skill** — `.claude/skills/qa-triage/SKILL.md`:

```markdown
---
name: qa-triage
description: Use to diagnose test failures and flakiness — decide whether a failing test is locator-drift (send to repair), a real behavior-regression (file a bug), or flaky, and record it. Triggers on "why did this fail", "is this flaky", "triage the failures", "diagnose this test".
---

# qa-triage — diagnose failures & flakiness

For each failing/uncertain spec, classify WHY and record it. Does not write tests or
bugs itself — it routes.

## Steps

1. Read `<repo>/.qa-agent/runs/<latest>.json` (or run the failing spec now). For a
   flakiness check, re-run a spec N times.
2. Classify with the engine (deterministic): `node <qa-agent>/dist/index.js triage
--repo <repo> --spec <path> --reruns 3`, or reason from the Playwright output —
   element-not-found/timeout → **locator-drift**; an assertion Expected/Received
   mismatch → **behavior-regression**; mixed pass/fail across reruns → **flaky**.
3. Record each non-passing spec in `<repo>/.qa-agent/flaky.json`:
   `{ "version": 1, "entries": [ { "spec": "tests/x.spec.ts", "caseId": "TC-...", "class": "flaky|locator-drift|behavior-regression|unknown", "note": "<evidence>", "updated": "<ISO8601>" } ] }`
   (one entry per spec, latest wins).
4. Route: **locator-drift** → suggest `qa-author`/repair (re-anchor locators, never
   weaken asserts). **behavior-regression** → the app likely violates the ticket →
   suggest `qa-bug` and set that case's `status` to `failing`. **flaky** → set case
   `status` to `flaky`.
5. Set this ticket's phase in `state.json` to `triaged`.

## Rules

- Distinguish an ENV problem (app down, browser missing) from a real failure — don't
  file drift/regression for a broken environment.
- Evidence, not guesses: quote the real output in the `note`.
```

- [ ] **Step 2: Dogfood** — demonstrate on the fixture: temporarily reason about a failing case (or the known-hollow `smoke.spec.ts` REJECTED result) and write a coherent `fixtures/login-app/.qa-agent/flaky.json` entry; set state phase `triaged`. Then `pnpm tsx scripts/check-casebook.mts fixtures/login-app` → ✔ (flaky.json doesn't affect it, just confirm no breakage).

- [ ] **Step 3: Gate + commit** — `pnpm check` green, then:

```bash
git add .claude/skills/qa-triage/SKILL.md
git add -f fixtures/login-app/.qa-agent
git commit -m "feat(qa-triage): classify failures/flakiness into the registry"
```

---

### Task 8: `qa-bug` skill + dogfood

**Files:** Create `.claude/skills/qa-bug/SKILL.md`. Dogfood writes a finding under `fixtures/login-app/.qa-agent/findings/`.

- [ ] **Step 1: Author the skill** — `.claude/skills/qa-bug/SKILL.md`:

```markdown
---
name: qa-bug
description: Use to write up a bug — a clear, evidence-backed finding linked to its case and acceptance criterion, either as a markdown finding or a Jira issue. Triggers on "file this bug", "write up the bug", "report this finding", "log a defect".
---

# qa-bug — write up a bug linked to its case

Turn a confirmed violation (app disagrees with the ticket) into a finding. The oracle
is the ticket, not the app.

## Steps

1. Identify the case (`TC-...`) and its acceptance criterion from `cases.md`.
2. Write `<repo>/.qa-agent/findings/<TICKET>-bug-<n>.md` with: title; linked case id +
   AC; **repro** (exact steps + data); **expected vs actual** (expected from the
   ticket); **evidence** (real command/output, not "I think"); **severity vs
   priority** (they differ). Keep app source untouched.
3. Set that case's `status` to `bug` in `cases.md`.
4. (Optional) If Jira is available (Atlassian MCP), also create the issue and note its
   key in the finding.
5. Report the finding path and the case it's linked to.

## Rules

- One finding = one defect, reproducible, evidence-backed. Never a passing test that
  freezes the bug as "correct".
```

- [ ] **Step 2: Dogfood** — the fixture's planted AC3 bug already lives in `reports/PROJ-42-findings.md`; write the casebook-linked version to `fixtures/login-app/.qa-agent/findings/PROJ-42-bug-1.md` (linked to the relevant case id + AC3, repro + evidence), and flip that case's `status` to `bug` in `cases.md`. Verify: `pnpm tsx scripts/check-casebook.mts fixtures/login-app` → ✔.

- [ ] **Step 3: Gate + commit** — `pnpm check` green, then:

```bash
git add .claude/skills/qa-bug/SKILL.md
git add -f fixtures/login-app/.qa-agent
git commit -m "feat(qa-bug): write case-linked, evidence-backed findings"
```

---

### Task 9: `qa-report` skill + dogfood

**Files:** Create `.claude/skills/qa-report/SKILL.md`. Dogfood writes `fixtures/login-app/.qa-agent/report.md`.

- [ ] **Step 1: Author the skill** — `.claude/skills/qa-report/SKILL.md`:

```markdown
---
name: qa-report
description: Use to produce the QA sign-off summary — what's covered by trusted tests, what's NOT and why, the spec gaps, and the bugs found — over the whole casebook. Triggers on "sign-off", "QA report", "what's covered", "release readiness", "summarize the QA".
---

# qa-report — the sign-off summary

Reads the whole casebook and renders an honest release-readiness summary. The discard
(what you chose NOT to test, and why) is part of the report.

## Steps

1. Read `cases.md`, `gaps.md`, `runs/<latest>.json`, and `findings/` from
   `<repo>/.qa-agent/`.
2. Compute coverage from case statuses (passing / total) and render the summary. The
   engine can render it for you deterministically — build (`pnpm build`) and call the
   `renderReport` helper via a short node script, or write the equivalent markdown:
   headline + coverage table; **covered by trusted tests**; **bugs found** (+ finding
   files); **NOT covered (and why to look)** (planned/authored/failing/flaky cases);
   **spec gaps** (from gaps.md).
3. Write it to `<repo>/.qa-agent/report.md` and set this ticket's phase in `state.json`
   to `reported`.
4. Present the summary to the user.

## Rules

- Be honest about what was NOT covered and why — that's the senior-QA value, not a gap
  to hide. Coverage is passing cases / total, not "tests written".
```

- [ ] **Step 2: Dogfood** — act as qa-report on `fixtures/login-app`: read the casebook, write `fixtures/login-app/.qa-agent/report.md` (coverage %, covered cases, the AC3 bug + finding, NOT-covered list, gaps), set state phase `reported`. Verify `pnpm tsx scripts/check-casebook.mts fixtures/login-app` → ✔.

- [ ] **Step 3: Gate + commit** — `pnpm check` green, then:

```bash
git add .claude/skills/qa-report/SKILL.md
git add -f fixtures/login-app/.qa-agent
git commit -m "feat(qa-report): whole-casebook sign-off summary"
```

---

### Task 10: Wire the router + docs + full-cycle dogfood

**Files:** Modify `.claude/skills/qa/SKILL.md`, `README.md`, `CHANGELOG.md`.

- [ ] **Step 1: Flip the router's Plan-2 markers** — in `.claude/skills/qa/SKILL.md`, remove the `_(Plan 2)_` / "not built yet, stop cleanly" caveats for `qa-run`/`qa-triage`/`qa-bug`/`qa-report` in BOTH the guided-flow list and the routing table, so the guided flow now runs the full cycle plan → author → run → triage → bug → report. Keep the checkpoints and "never skip the plan" rule.

- [ ] **Step 2: README** — in `README.md`, update the sidekick section's stages line from "`qa-run · qa-triage · qa-bug · qa-report _(the last four are Plan 2)_`" to list all six as built, and change the "Not yet built (Plan 2)" bullet in Status to reflect that the back-of-cycle stages now exist (leaving element caching / live-CLI notes).

- [ ] **Step 3: CHANGELOG** — add under the top section:

```markdown
### Added

- Back-of-cycle stages: `qa-run` (run + coverage), `qa-triage` (failure/flakiness
  classification), `qa-bug` (case-linked findings), `qa-report` (sign-off). Casebook
  gains run records (`runs/`), a flaky registry (`flaky.json`), findings I/O, and the
  `caseTag`/`run`/`flaky`/`report` modules.
```

- [ ] **Step 4: Full-cycle dogfood** — confirm the fixture casebook now reaches `phase: reported` with a coherent chain: `cases.md` (mix of passing + a bug), a `runs/<date>.json`, a `findings/` entry, and `report.md`. Run `pnpm tsx scripts/check-casebook.mts fixtures/login-app` → ✔ and `pnpm check` → green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/qa/SKILL.md README.md CHANGELOG.md
git add -f fixtures/login-app/.qa-agent
git commit -m "feat(qa): wire the full cycle (run→triage→bug→report) + docs"
```

---

## Self-Review

**Spec coverage (design §5 stages):** qa-run → Task 6; qa-triage → Task 7; qa-bug → Task 8; qa-report → Task 9; router wiring → Task 10. Their artifacts: `runs/` (Task 2 model + Task 5 I/O), `flaky.json` (Task 3 + Task 5), `findings/` (Task 5 + Task 8), coverage/report (Tasks 2/4). Case→spec linkage (spec `// case:` tag) → Task 1. ✓

**Placeholder scan:** every code and skill step has complete content; no TBD. ✓

**Type consistency:** `RunRecord`/`CaseRunResult`/`Coverage` (run.ts) consumed by report.ts and store.ts with matching names; `FlakyRegistry`/`FlakyEntry` (flaky.ts) consumed by store.ts; `updateCase` signature matches its test; store additions (`writeRun`/`readLatestRun`/`readFlaky`/`writeFlaky`/`readGaps`/`listFindings`/`writeFinding`) match the interface summary and the store test. `CaseStatus` values used (`passing`/`failing`/`flaky`/`bug`) all exist in cases.ts. `FlakyClass` mirrors triage's `FailureClass` minus `passing`. ✓

**YAGNI:** report renderer via a pure function (skills can render markdown directly if they skip the node call — the helper is for determinism/testability, and Task 5's I/O it depends on is all consumed by the stages). No Jira hard-dependency (optional in qa-bug). No new deps.
