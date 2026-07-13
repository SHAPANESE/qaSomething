# QA Sidekick — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the front of the QA-sidekick cycle inside Claude Code — a `.qa-agent/` casebook (the shared, traceable QA state) plus a `qa-plan` stage-skill that turns a ticket into risk-ranked, criterio-audited test cases + spec gaps, a `qa` router skill, and an adapted `qa-author` skill that authors specs from those cases.

**Architecture:** A small TypeScript module (`src/casebook/`) owns the on-disk QA workspace: pure parse/serialize for `cases.md` (case-per-frontmatter-block), `state.json` (the cycle state machine), plus an I/O layer. The stage-skills are markdown prompt artifacts that read/write the casebook via the CLI/Node and call the existing engine as deterministic "hands". Stages are stateless; the casebook holds state, so guided-flow and à-la-carte use share one path.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import extensions, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`), zod (validation), vitest (tests), Claude Code skills (markdown). No new runtime dependencies.

## Global Constraints

- **Language/module:** TypeScript, `module: NodeNext`. All relative imports MUST use the `.js` extension (e.g. `import { x } from "./cases.js"`). Type-only imports MUST use `import type` (`verbatimModuleSyntax` is on).
- **`exactOptionalPropertyTypes` is on:** never assign `undefined` to an optional property — omit the key instead.
- **`noUncheckedIndexedAccess` is on:** index access yields `T | undefined`; use `!` only when provably present, otherwise guard.
- **Validation pattern:** validate all parsed external data with `zod` `.strict()` schemas, mirroring `src/projectConfig.ts`.
- **Test framework:** vitest; `import { describe, expect, it } from "vitest";`. Tests live next to source as `*.test.ts` (excluded from the build by `tsconfig.json`).
- **No new module named `workspace`:** `src/workspace.ts` already exists (the git write-guard). The QA workspace module is `src/casebook/`. The on-disk directory is `.qa-agent/` (already in the write-guard allowlist).
- **Casebook directory constant:** `.qa-agent`.
- **Case-ID format:** `TC-<TICKET>-NN` where `NN` is zero-padded to ≥2 digits.
- **Commit style:** Conventional Commits (`feat:`, `test:`, `docs:`, `refactor:`), matching the existing history.
- **Gate before every commit:** `pnpm check` (typecheck + lint + format:check + test) must pass.
- **App source is read-only** in any skill: skills write only under `tests/`, `reports/`, and `.qa-agent/`. A buggy app is a finding, never an app edit.

---

## File Structure

**New (Plan 1):**
- `src/casebook/caseId.ts` — pure: make/parse/next stable case IDs. + `caseId.test.ts`
- `src/casebook/cases.ts` — case model (types + zod), parse/serialize `cases.md`. + `cases.test.ts`
- `src/casebook/state.ts` — cycle-state model + machine, parse/serialize `state.json`. + `state.test.ts`
- `src/casebook/store.ts` — I/O: paths, ensure dirs, read/write cases/state/plan/gaps. + `store.test.ts`
- `scripts/check-casebook.mts` — runnable validator: assert a produced casebook parses and shows real criterio (non-happy categories + gaps).
- `.claude/skills/qa-plan/SKILL.md` — the planning/discovery stage.
- `.claude/skills/qa/SKILL.md` — the router (guided flow + à la carte).
- `.claude/skills/qa-author/SKILL.md` — authoring stage, adapted from the current `qa-agent` skill to read `cases.md`.

**Modified:**
- `README.md` — document the sidekick + casebook.
- `CHANGELOG.md` — add the entries.
- `.claude/skills/qa-agent/SKILL.md` — add a one-line pointer that it is superseded by the `qa` suite (kept for back-compat).

**Interface summary (locked here, consumed by later tasks and Plan 2):**
```ts
// caseId.ts
makeCaseId(ticketId: string, n: number): string
parseCaseId(id: string): { ticket: string; n: number } | null
nextCaseNumber(existing: string[], ticketId: string): number

// cases.ts
type ScenarioCategory  // "happy" | "negative" | "boundary" | ...
type CaseStatus        // "planned" | "authored" | "passing" | "failing" | "flaky" | "bug"
type CasePriority      // "high" | "medium" | "low"
interface TestCase { id; ac; priority; category; status; spec?; description }
parseCases(md: string): TestCase[]
serializeCases(cases: TestCase[]): string

// state.ts
type CyclePhase        // "planned" | "authored" | "run" | "triaged" | "reported"
interface CasebookState { version: 1; tickets: Record<string, TicketState> }
emptyState(): CasebookState
parseState(raw: string): CasebookState
serializeState(state: CasebookState): string
nextPhase(phase: CyclePhase): CyclePhase | null
setPhase(state, ticketId, phase, updated): CasebookState

// store.ts
CASEBOOK_DIR = ".qa-agent"
casebookPaths(repo: string): { dir; plan; cases; gaps; state; runs; findings; flaky }
ensureCasebook(repo: string): Promise<void>
readCases(repo): Promise<TestCase[]>;  writeCases(repo, cases): Promise<void>
readState(repo): Promise<CasebookState>; writeState(repo, state): Promise<void>
writePlan(repo, md): Promise<void>;  appendGap(repo, line): Promise<void>
```

---

### Task 1: Case IDs (`src/casebook/caseId.ts`)

**Files:**
- Create: `src/casebook/caseId.ts`
- Test: `src/casebook/caseId.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeCaseId(ticketId, n)`, `parseCaseId(id)`, `nextCaseNumber(existing, ticketId)` (see interface summary).

- [ ] **Step 1: Write the failing test**

Create `src/casebook/caseId.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { makeCaseId, nextCaseNumber, parseCaseId } from "./caseId.js";

describe("makeCaseId", () => {
  it("formats as TC-<TICKET>-NN with zero padding and an uppercase slug", () => {
    expect(makeCaseId("proj-12", 3)).toBe("TC-PROJ-12-03");
    expect(makeCaseId("JIRA_99", 12)).toBe("TC-JIRA-99-12");
  });
  it("collapses non-alphanumerics into single dashes and trims them", () => {
    expect(makeCaseId("  Sign up flow! ", 1)).toBe("TC-SIGN-UP-FLOW-01");
  });
});

describe("parseCaseId", () => {
  it("round-trips a made id", () => {
    expect(parseCaseId("TC-PROJ-12-03")).toEqual({ ticket: "PROJ-12", n: 3 });
  });
  it("returns null for non-matching ids", () => {
    expect(parseCaseId("nope")).toBeNull();
    expect(parseCaseId("TC-X-1")).toBeNull(); // needs >= 2 digits
  });
});

describe("nextCaseNumber", () => {
  it("returns 1 when no existing ids match the ticket", () => {
    expect(nextCaseNumber([], "PROJ-12")).toBe(1);
    expect(nextCaseNumber(["TC-OTHER-05"], "PROJ-12")).toBe(1);
  });
  it("returns max+1 across matching ids only", () => {
    expect(nextCaseNumber(["TC-PROJ-12-01", "TC-PROJ-12-04", "TC-OTHER-09"], "proj-12")).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/casebook/caseId.test.ts`
Expected: FAIL — cannot find module `./caseId.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/casebook/caseId.ts`:
```ts
/**
 * Stable test-case IDs: `TC-<TICKET>-NN`. One id threads a case through
 * plan → spec → run → bug — the traceability backbone of the casebook.
 */

const CASE_ID_RE = /^TC-(.+)-(\d{2,})$/;

function slugify(ticketId: string): string {
  return ticketId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeCaseId(ticketId: string, n: number): string {
  return `TC-${slugify(ticketId)}-${String(n).padStart(2, "0")}`;
}

export interface ParsedCaseId {
  ticket: string;
  n: number;
}

export function parseCaseId(id: string): ParsedCaseId | null {
  const m = id.match(CASE_ID_RE);
  if (!m) return null;
  return { ticket: m[1]!, n: Number.parseInt(m[2]!, 10) };
}

/** Next free case number for a ticket, given the ids already in the casebook. */
export function nextCaseNumber(existing: string[], ticketId: string): number {
  const slug = slugify(ticketId);
  let max = 0;
  for (const id of existing) {
    const parsed = parseCaseId(id);
    if (parsed && parsed.ticket === slug) max = Math.max(max, parsed.n);
  }
  return max + 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/casebook/caseId.test.ts`
Expected: PASS (7 assertions across 3 describes).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/caseId.ts src/casebook/caseId.test.ts
git commit -m "feat(casebook): stable TC-<TICKET>-NN case ids"
```

---

### Task 2: Case model + `cases.md` parse/serialize (`src/casebook/cases.ts`)

**Files:**
- Create: `src/casebook/cases.ts`
- Test: `src/casebook/cases.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained; ids are plain strings validated by regex).
- Produces: `ScenarioCategory`, `CaseStatus`, `CasePriority`, `TestCase`, `TestCaseSchema`, `parseCases(md)`, `serializeCases(cases)`.

- [ ] **Step 1: Write the failing test**

Create `src/casebook/cases.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseCases, serializeCases, type TestCase } from "./cases.js";

const sample: TestCase[] = [
  {
    id: "TC-PROJ-12-01",
    ac: "AC-1: valid credentials log the user in",
    priority: "high",
    category: "happy",
    status: "planned",
    spec: "tests/login.spec.ts",
    description: "Given valid credentials, submitting logs in and lands on /home.",
  },
  {
    id: "TC-PROJ-12-02",
    ac: "AC-2: empty email is rejected",
    priority: "high",
    category: "negative",
    status: "planned",
    description: "Submitting with an empty email shows an inline error and does not call the API.",
  },
];

describe("serializeCases / parseCases", () => {
  it("round-trips cases through markdown", () => {
    const md = serializeCases(sample);
    expect(parseCases(md)).toEqual(sample);
  });

  it("omits the spec key when a case has no spec", () => {
    const md = serializeCases([sample[1]!]);
    expect(md).not.toContain("spec:");
    const back = parseCases(md);
    expect(back[0]).not.toHaveProperty("spec");
  });

  it("parses a hand-written cases.md block", () => {
    const md = [
      "---",
      "id: TC-X-01",
      'ac: "AC: boundary — 256-char name"',
      "priority: medium",
      "category: boundary",
      "status: planned",
      "---",
      "A name at the max length saves; one over shows a length error.",
      "",
    ].join("\n");
    const cases = parseCases(md);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.category).toBe("boundary");
    expect(cases[0]!.ac).toBe("AC: boundary — 256-char name");
  });

  it("rejects an invalid category via the schema", () => {
    const md = ["---", "id: TC-X-01", "ac: x", "priority: low", "category: bogus", "status: planned", "---", "body", ""].join("\n");
    expect(() => parseCases(md)).toThrow();
  });

  it("returns [] for empty input", () => {
    expect(parseCases("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/casebook/cases.test.ts`
Expected: FAIL — cannot find module `./cases.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/casebook/cases.ts`:
```ts
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
const BLOCK_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*?)(?=\n---[ \t]*\n|\s*$)/gm;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/casebook/cases.test.ts`
Expected: PASS (5 tests).

Note: the round-trip test relies on `ac` values containing no embedded double-quote. That is an accepted constraint of the simple format; keep `ac` quote-free (documented in the file header intent).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/cases.ts src/casebook/cases.test.ts
git commit -m "feat(casebook): case model + cases.md parse/serialize with scenario-coverage"
```

---

### Task 3: Cycle-state machine (`src/casebook/state.ts`)

**Files:**
- Create: `src/casebook/state.ts`
- Test: `src/casebook/state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CyclePhase`, `CYCLE_PHASES`, `TicketState`, `CasebookState`, `emptyState()`, `parseState(raw)`, `serializeState(state)`, `nextPhase(phase)`, `setPhase(state, ticketId, phase, updated)`.

- [ ] **Step 1: Write the failing test**

Create `src/casebook/state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { emptyState, nextPhase, parseState, serializeState, setPhase } from "./state.js";

describe("nextPhase", () => {
  it("advances through the cycle and stops at the end", () => {
    expect(nextPhase("planned")).toBe("authored");
    expect(nextPhase("triaged")).toBe("reported");
    expect(nextPhase("reported")).toBeNull();
  });
});

describe("setPhase", () => {
  it("records a ticket's phase without mutating the input", () => {
    const s0 = emptyState();
    const s1 = setPhase(s0, "PROJ-12", "planned", "2026-07-13T00:00:00.000Z");
    expect(s0.tickets).toEqual({});
    expect(s1.tickets["PROJ-12"]).toEqual({
      ticketId: "PROJ-12",
      phase: "planned",
      updated: "2026-07-13T00:00:00.000Z",
    });
  });
});

describe("parseState / serializeState", () => {
  it("round-trips", () => {
    const s = setPhase(emptyState(), "PROJ-12", "authored", "2026-07-13T00:00:00.000Z");
    expect(parseState(serializeState(s))).toEqual(s);
  });
  it("rejects an unknown phase", () => {
    const raw = JSON.stringify({ version: 1, tickets: { X: { ticketId: "X", phase: "nope", updated: "t" } } });
    expect(() => parseState(raw)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/casebook/state.test.ts`
Expected: FAIL — cannot find module `./state.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/casebook/state.ts`:
```ts
import { z } from "zod";

/**
 * Per-ticket position in the QA cycle. The router reads this to know "where are
 * we" so the guided flow and à-la-carte entry share one code path. State lives
 * on disk (and in git), so a cycle is resumable across sessions.
 */

export const CYCLE_PHASES = ["planned", "authored", "run", "triaged", "reported"] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];

export const TicketStateSchema = z
  .object({
    ticketId: z.string().min(1),
    phase: z.enum(CYCLE_PHASES),
    updated: z.string().min(1),
  })
  .strict();
export type TicketState = z.infer<typeof TicketStateSchema>;

export const CasebookStateSchema = z
  .object({
    version: z.literal(1),
    tickets: z.record(z.string(), TicketStateSchema),
  })
  .strict();
export type CasebookState = z.infer<typeof CasebookStateSchema>;

export function emptyState(): CasebookState {
  return { version: 1, tickets: {} };
}

export function parseState(raw: string): CasebookState {
  return CasebookStateSchema.parse(JSON.parse(raw));
}

export function serializeState(state: CasebookState): string {
  return JSON.stringify(state, null, 2) + "\n";
}

/** The next phase in the guided flow, or null at the end. */
export function nextPhase(phase: CyclePhase): CyclePhase | null {
  const i = CYCLE_PHASES.indexOf(phase);
  return i >= 0 && i < CYCLE_PHASES.length - 1 ? CYCLE_PHASES[i + 1]! : null;
}

/** Pure: set a ticket's phase, returning a new state (caller supplies the timestamp). */
export function setPhase(
  state: CasebookState,
  ticketId: string,
  phase: CyclePhase,
  updated: string,
): CasebookState {
  return {
    ...state,
    tickets: { ...state.tickets, [ticketId]: { ticketId, phase, updated } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/casebook/state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/casebook/state.ts src/casebook/state.test.ts
git commit -m "feat(casebook): cycle-state machine (planned→…→reported)"
```

---

### Task 4: Casebook I/O layer (`src/casebook/store.ts`)

**Files:**
- Create: `src/casebook/store.ts`
- Test: `src/casebook/store.test.ts`

**Interfaces:**
- Consumes: `parseCases`/`serializeCases`/`TestCase` from `./cases.js`; `emptyState`/`parseState`/`serializeState`/`CasebookState` from `./state.js`.
- Produces: `CASEBOOK_DIR`, `casebookPaths(repo)`, `ensureCasebook(repo)`, `readCases`/`writeCases`, `readState`/`writeState`, `writePlan`, `appendGap`.

- [ ] **Step 1: Write the failing test**

Create `src/casebook/store.test.ts`:
```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendGap, casebookPaths, readCases, readState, writeCases, writePlan, writeState } from "./store.js";
import { emptyState, setPhase } from "./state.js";
import type { TestCase } from "./cases.js";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "casebook-"));
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const oneCase: TestCase = {
  id: "TC-PROJ-12-01",
  ac: "AC-1",
  priority: "high",
  category: "negative",
  status: "planned",
  description: "empty email rejected",
};

describe("readCases", () => {
  it("returns [] when no casebook exists yet", async () => {
    expect(await readCases(repo)).toEqual([]);
  });
});

describe("writeCases / readCases", () => {
  it("persists and reads back cases (creating .qa-agent)", async () => {
    await writeCases(repo, [oneCase]);
    expect(await readCases(repo)).toEqual([oneCase]);
  });
});

describe("readState / writeState", () => {
  it("defaults to an empty state, then round-trips", async () => {
    expect(await readState(repo)).toEqual(emptyState());
    const s = setPhase(emptyState(), "PROJ-12", "planned", "2026-07-13T00:00:00.000Z");
    await writeState(repo, s);
    expect(await readState(repo)).toEqual(s);
  });
});

describe("writePlan / appendGap", () => {
  it("writes plan.md and appends gaps.md lines", async () => {
    await writePlan(repo, "# Plan\n");
    await appendGap(repo, "GAP: whitespace-only email undefined");
    await appendGap(repo, "GAP: max length unspecified");
    expect(await readFile(casebookPaths(repo).plan, "utf8")).toBe("# Plan\n");
    expect(await readFile(casebookPaths(repo).gaps, "utf8")).toBe(
      "GAP: whitespace-only email undefined\nGAP: max length unspecified\n",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/casebook/store.test.ts`
Expected: FAIL — cannot find module `./store.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/casebook/store.ts`:
```ts
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCases, serializeCases, type TestCase } from "./cases.js";
import { emptyState, parseState, serializeState, type CasebookState } from "./state.js";

/**
 * The casebook I/O layer: reads and writes the `.qa-agent/` QA workspace in the
 * repo under test. `.qa-agent/` is already inside the write-guard allowlist, so
 * these writes survive the git-backed guard. Pure parse/serialize lives in
 * cases.ts / state.ts; this file only touches the filesystem.
 */

export const CASEBOOK_DIR = ".qa-agent";

export interface CasebookPaths {
  dir: string;
  plan: string;
  cases: string;
  gaps: string;
  state: string;
  runs: string;
  findings: string;
  flaky: string;
}

export function casebookPaths(repo: string): CasebookPaths {
  const dir = path.join(repo, CASEBOOK_DIR);
  return {
    dir,
    plan: path.join(dir, "plan.md"),
    cases: path.join(dir, "cases.md"),
    gaps: path.join(dir, "gaps.md"),
    state: path.join(dir, "state.json"),
    runs: path.join(dir, "runs"),
    findings: path.join(dir, "findings"),
    flaky: path.join(dir, "flaky.json"),
  };
}

export async function ensureCasebook(repo: string): Promise<void> {
  const p = casebookPaths(repo);
  await mkdir(p.runs, { recursive: true });
  await mkdir(p.findings, { recursive: true });
}

export async function readCases(repo: string): Promise<TestCase[]> {
  const p = casebookPaths(repo);
  if (!existsSync(p.cases)) return [];
  return parseCases(await readFile(p.cases, "utf8"));
}

export async function writeCases(repo: string, cases: TestCase[]): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(casebookPaths(repo).cases, serializeCases(cases), "utf8");
}

export async function readState(repo: string): Promise<CasebookState> {
  const p = casebookPaths(repo);
  if (!existsSync(p.state)) return emptyState();
  return parseState(await readFile(p.state, "utf8"));
}

export async function writeState(repo: string, state: CasebookState): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(casebookPaths(repo).state, serializeState(state), "utf8");
}

export async function writePlan(repo: string, markdown: string): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(casebookPaths(repo).plan, markdown, "utf8");
}

export async function appendGap(repo: string, line: string): Promise<void> {
  await ensureCasebook(repo);
  await appendFile(casebookPaths(repo).gaps, line.endsWith("\n") ? line : `${line}\n`, "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/casebook/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate + commit**

Run: `pnpm check`
Expected: typecheck + lint + format:check + all tests PASS. (If `format:check` flags the new files, run `pnpm format` and re-run.)

```bash
git add src/casebook/store.ts src/casebook/store.test.ts
git commit -m "feat(casebook): filesystem I/O for the .qa-agent workspace"
```

---

### Task 5: `qa-plan` skill + casebook validator

The planning/discovery stage: ticket → risk-ranked, criterio-audited cases + gaps. This is the largest net-new value. It is a Claude Code skill (a prompt artifact); its "test" is a dogfood run whose output is checked mechanically by `scripts/check-casebook.mts` using the casebook module — evidence, not the model's word.

**Files:**
- Create: `.claude/skills/qa-plan/SKILL.md`
- Create: `scripts/check-casebook.mts`

**Interfaces:**
- Consumes: `readCases`, `casebookPaths` from `src/casebook/store.js`; `SCENARIO_CATEGORIES` from `src/casebook/cases.js`.
- Produces: a validated `.qa-agent/` (plan.md, cases.md, gaps.md, state.json) for the fixture.

- [ ] **Step 1: Write the validator (the gate for this task)**

Create `scripts/check-casebook.mts`:
```ts
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
if (nonHappy.length === 0) problems.push("no non-happy cases — criterio not exercised (negatives/boundaries?)");

if (!existsSync(paths.gaps)) problems.push("no gaps.md — spec was not questioned");

if (problems.length > 0) {
  console.error("✗ casebook check FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ casebook check passed: ${cases.length} cases, categories: ${[...categories].join(", ")}`);
```

- [ ] **Step 2: Author the `qa-plan` skill**

Create `.claude/skills/qa-plan/SKILL.md`:
```markdown
---
name: qa-plan
description: Use to turn a ticket / acceptance criteria into a risk-ranked, criterio-audited QA plan BEFORE writing any test — enumerates cases across scenario categories (negatives, boundaries, state, concurrency, security…), flags spec gaps as findings, and writes them to the .qa-agent casebook. Triggers on "plan QA for", "what should we test", "design test cases for", "analyze this ticket".
---

# qa-plan — design the tests before writing them

You ARE a senior QA engineer doing the *thinking* stage. Output is reviewable
artifacts in the `.qa-agent/` casebook, not code. Do NOT write Playwright tests
here — that is `qa-author`.

## Inputs to establish first

- **Repo under test** (`--repo <path>`), and the **ticket = the oracle** (file or
  Jira via the Atlassian MCP). No ticket → say so and ask; without a source of
  truth you would freeze current bugs as "correct".

## Non-negotiable process (from docs/qa-senior-criteria.md — load it and follow it)

1. **PHASE 1 — Prioritize by risk (always first).** Risk = Impact × Probability.
   Produce an ordered list of what is worth testing and **explicitly discard**
   the low-value items with a reason. If you discarded nothing, you did not
   prioritize.
2. **PHASE 2 — Discovery pass per prioritized item.** For each item, walk the
   scenario categories and decide, per category, one of: **covered** (write a
   case), **discarded** (say why), or **gap** (the ticket does not define it →
   record it in gaps.md). Categories: happy, negative, boundary, state,
   concurrency, idempotency, data-integrity, interruption, security, a11y,
   performance, compatibility, i18n. **Happy path is the floor, not the goal.**
3. **Question the spec.** Ambiguity, undefined edge case, contradiction, or an
   unstated assumption is a FINDING → gaps.md, before any test exists.
4. **Optional exploratory pass** to surface what the ticket does not say: use the
   `explore` module / tours / "follow the data" / CRUD-per-entity.

## Writing the casebook

Write these files under `<repo>/.qa-agent/` (create the dir if missing):

- **plan.md** — the risk ranking: what to test, what was discarded and why.
- **cases.md** — one block per case, in this exact format (parsed by the
  casebook module, so match it):
  ```
  ---
  id: TC-<TICKET>-NN
  ac: "<which acceptance criterion>"
  priority: high|medium|low
  category: happy|negative|boundary|state|concurrency|idempotency|data-integrity|interruption|security|a11y|performance|compatibility|i18n
  status: planned
  ---
  <one or two sentences: the scenario and its expected result>
  ```
  Number cases sequentially per ticket (TC-<TICKET>-01, -02, …). Each prioritized
  item should have MORE than a happy case where risk warrants it — a
  prioritized item with only a happy case must be justified in plan.md.
- **gaps.md** — one line per spec gap/ambiguity/contradiction found.
- **state.json** — set this ticket's phase to `planned`. If unsure of the exact
  JSON, run:
  `node <qa-agent>/dist/index.js` is NOT needed — write state.json as
  `{ "version": 1, "tickets": { "<TICKET>": { "ticketId": "<TICKET>", "phase": "planned", "updated": "<ISO8601>" } } }`.

## Definition of done

- plan.md shows an explicit risk ranking WITH discards.
- cases.md covers non-happy categories (negatives/boundaries at minimum) for the
  high-risk items, each tagged with its category — the coverage is auditable.
- gaps.md lists what the ticket leaves undefined.
- You stated what you did NOT plan to test and why.
```

- [ ] **Step 3: Dogfood on the fixture and gate with the validator**

The fixture `fixtures/login-app/` has ticket `tickets/PROJ-42.md` (planted AC3 bug: no empty-email validation). Acting as the `qa-plan` skill, produce `fixtures/login-app/.qa-agent/` (plan.md, cases.md with ≥1 negative + ≥1 boundary case, gaps.md flagging the whitespace/empty ambiguity, state.json phase `planned`).

Run: `pnpm tsx scripts/check-casebook.mts fixtures/login-app`
Expected: `✔ casebook check passed: N cases, categories: happy, negative, boundary, …`

If it fails, fix the produced casebook (add the missing non-happy cases / gaps.md) until the check passes. This is the criterio gate — a happy-path-only plan fails here.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/qa-plan/SKILL.md scripts/check-casebook.mts fixtures/login-app/.qa-agent
git commit -m "feat(qa-plan): criterio-driven planning stage + auditable casebook check"
```

---

### Task 6: `qa` router skill

The thin router: reads `state.json`, runs the guided flow with approval checkpoints, or routes straight to one stage à la carte.

**Files:**
- Create: `.claude/skills/qa/SKILL.md`

**Interfaces:**
- Consumes: the other stage skills by name (`qa-plan`, `qa-author`); the casebook `state.json`.
- Produces: nothing on disk itself (delegates to stages).

- [ ] **Step 1: Author the router skill**

Create `.claude/skills/qa/SKILL.md`:
```markdown
---
name: qa
description: Use as the entry point for QA work on a ticket — the QA sidekick router. Runs the whole cycle as a guided flow (plan → author → run → triage → bug → report) with approval checkpoints, OR routes straight to one stage à la carte. Triggers on "QA this ticket", "run the QA cycle", "be my QA sidekick", or when the user asks for QA work without naming a stage.
---

# qa — the QA sidekick router

You coordinate the QA cycle over the `.qa-agent/` casebook. Stages are stateless;
the casebook holds state, so you can start cold at any stage and still have
context. Read `<repo>/.qa-agent/state.json` first to learn where each ticket is.

## Two modes

- **Guided flow (default when given a ticket):** walk the cycle with checkpoints —
  after each stage, show the artifact and get the user's OK before advancing:
  1. `qa-plan` → present plan.md + cases.md + gaps.md → **checkpoint**
  2. `qa-author` → present the specs + trust-gate verdicts → **checkpoint**
  3. `qa-run` / `qa-triage` / `qa-bug` / `qa-report` (Plan 2; until then, say the
     stage is not built yet and stop cleanly).
  Advance the ticket's phase in state.json after each completed stage
  (planned → authored → run → triaged → reported).

- **À la carte:** if the user asks for one thing ("plan cases for X", "why is this
  test flaky?"), route directly to that stage skill. The stage finds its context
  in the casebook.

## Routing table

| User intent | Stage |
| --- | --- |
| plan / analyze ticket / what to test | `qa-plan` |
| write / generate tests from the plan | `qa-author` |
| run tests / coverage vs plan | `qa-run` *(Plan 2)* |
| why did this fail / flaky | `qa-triage` *(Plan 2)* |
| file / report a bug | `qa-bug` *(Plan 2)* |
| sign-off / what's covered | `qa-report` *(Plan 2)* |

## Rules

- Never skip the plan: authoring without cases.md means no criterio and no
  traceability. If asked to author with no casebook, run `qa-plan` first (or ask).
- App source is read-only across every stage.
- Keep the user in control at checkpoints — do not run the whole flow unattended
  unless they say so.
```

- [ ] **Step 2: Validate routing by inspection (dogfood)**

Confirm the skill loads and routes: given "plan QA for fixtures/login-app ticket PROJ-42", the router selects `qa-plan`; given "QA this ticket end to end", it starts the guided flow at `qa-plan` and stops cleanly at the first Plan-2 stage. (No code test — this is a prompt artifact; verify by reading the routing table covers each intent in the spec's stage list.)

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/qa/SKILL.md
git commit -m "feat(qa): router skill — guided flow + à la carte over the casebook"
```

---

### Task 7: Adapt `qa-author` to read the casebook

Repurpose the current `qa-agent` skill into `qa-author`: it reads `cases.md`, authors a spec per case, tags each spec with its `case-id`, and updates that case's `status` to `authored` (and `spec` path). Keeps every existing non-negotiable (mutation proof, semantic locators, read-only app, ticket oracle, trust gates).

**Files:**
- Create: `.claude/skills/qa-author/SKILL.md`
- Modify: `.claude/skills/qa-agent/SKILL.md` (add a supersede pointer)

**Interfaces:**
- Consumes: `cases.md` (each `TestCase`), the ticket oracle, the engine `verify` CLI.
- Produces: `tests/<name>.spec.ts` (+ `.mutation.spec.ts`) each tagged with its case-id; updated `cases.md` (`status: authored`, `spec: <path>`).

- [ ] **Step 1: Author the `qa-author` skill**

Create `.claude/skills/qa-author/SKILL.md`:
```markdown
---
name: qa-author
description: Use to write trustworthy Playwright tests from a QA plan's cases — reads .qa-agent/cases.md, writes one spec (+ a mutation proof) per case tagged with its case-id, verifies each with the trust gates, and reports bugs where the app violates the ticket. Triggers on "write the tests", "author tests from the plan", "generate e2e tests for these cases".
---

# qa-author — write trustworthy tests from the plan

You ARE a senior QA engineer. Author from the casebook, not from scratch: read
`<repo>/.qa-agent/cases.md`. If it is empty, stop and ask for `qa-plan` first —
authoring without cases means no criterio and no traceability.

## Non-negotiable rules

1. **App source is READ-ONLY.** Write only to `tests/` and `reports/` (and update
   `.qa-agent/cases.md` status). A buggy app is a FINDING, never an app edit.
2. **Ticket = oracle.** Test against the ticket's acceptance criteria, not against
   whatever the app currently does.
3. **Every real `X.spec.ts` needs a sibling `X.mutation.spec.ts`** that breaks the
   behavior with the SAME assertions and MUST fail — network apps: `page.route`;
   client-only apps: the interaction-freeze strategy (`src/mutate.ts`). Semantic
   locators only (getByRole/getByLabel/data-testid); no xpath/nth-child/sleep.

## Steps

1. Read `cases.md`. For each case with `status: planned` and a category the app
   satisfies, author `tests/<name>.spec.ts` + `tests/<name>.mutation.spec.ts`.
   **Tag each spec with its case-id** — first line of the spec file:
   `// case: TC-<TICKET>-NN` — so run/triage can re-link it.
2. For each case the app VIOLATES, write a bug finding to
   `reports/<TICKET>-findings.md` (repro + real evidence), NOT a passing test.
3. Update that case in `cases.md`: `status: authored` and `spec: tests/<name>.spec.ts`.
4. **Verify with the trust gates:**
   `node <qa-agent>/dist/index.js verify --repo <repo> --all --reruns 3`
   Every kept test must be **✔ TRUSTED**. Fix any **✗ REJECTED** (flaky or hollow).
5. Summarize: which cases are now covered by trusted tests, which produced bugs.

## Definition of done

- Each authored spec is TRUSTED (stable pass + its mutation goes red) and carries
  its `// case:` tag.
- Each planned case is either `authored` (with a spec) or has a bug finding.
- cases.md reflects the new statuses.
```

- [ ] **Step 2: Add the supersede pointer to the old skill**

Edit `.claude/skills/qa-agent/SKILL.md` — insert directly under the H1 title line `# QA Agent — act as a senior QA engineer`:
```markdown

> Superseded by the **qa** sidekick suite (`qa` router + `qa-plan` / `qa-author`).
> Kept for back-compat; new work should start from the `qa` skill.
```

- [ ] **Step 3: Dogfood plan → author on the fixture**

Using the `fixtures/login-app/.qa-agent/cases.md` produced in Task 5, act as `qa-author`: author a spec (+ mutation) for one `planned` case, tag it `// case: TC-...`, update that case to `status: authored` with its `spec` path.

Verify the casebook still parses and the status updated:
Run: `pnpm tsx scripts/check-casebook.mts fixtures/login-app`
Expected: `✔ casebook check passed`.
Then confirm the update took:
Run: `node -e "import('./src/casebook/store.js').then(async m => { const c = await m.readCases('fixtures/login-app'); console.log(c.filter(x => x.status === 'authored').map(x => x.id + ' -> ' + x.spec)); })"`
Expected: prints the authored case id → its spec path (non-empty).

(If the fixture cannot run Playwright in this environment, still verify the casebook status update and the `// case:` tag by reading the spec file; note the trust-gate run is exercised fully in Task 8's dogfood where the app runs.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/qa-author/SKILL.md .claude/skills/qa-agent/SKILL.md fixtures/login-app
git commit -m "feat(qa-author): author specs from the casebook, tagged + status-tracked"
```

---

### Task 8: Docs + full-slice dogfood

Wire the story together in the README/CHANGELOG and prove the front-of-cycle slice end to end on the fixture.

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full-slice dogfood (plan → author → verify) on the fixture**

Acting via the `qa` router on `fixtures/login-app` + `tickets/PROJ-42.md`:
1. `qa-plan` → `.qa-agent/` produced; `pnpm tsx scripts/check-casebook.mts fixtures/login-app` → ✔.
2. `qa-author` → specs authored from the planned cases, cases.md statuses updated.
3. Trust gates: `node dist/index.js verify --repo fixtures/login-app --all --reruns 3` (build first: `pnpm build`).
   Expected: authored specs come back **✔ TRUSTED**; the planted AC3 bug appears as a finding in `reports/PROJ-42-findings.md`, NOT as a passing test.

- [ ] **Step 2: Update the README**

In `README.md`, add a section after "What it does" describing the sidekick:
```markdown
## The QA sidekick (stages + casebook)

Beyond one-shot authoring, `qa-agent` works across the QA cycle from inside Claude
Code via a suite of stage-skills coordinated by a `qa` router, all sharing a
**casebook** — `.qa-agent/` in the repo under test:

| File | Holds |
| --- | --- |
| `plan.md` | risk-ranked plan: what to test, what was discarded, why |
| `cases.md` | test cases with a stable id, AC, priority, and **scenario category** (auditable criterio) |
| `gaps.md` | spec ambiguities / undefined edge cases (findings before any test) |
| `state.json` | each ticket's position in the cycle (planned → … → reported) |

A stable case id (`TC-<TICKET>-NN`) threads requirement → case → spec → run → bug —
a traceability matrix. Stages are stateless; the casebook holds state, so you can
run the guided flow or jump to any stage à la carte.

Stages: **qa-plan** (design + criterio audit) · **qa-author** (write trustworthy
specs) · qa-run · qa-triage · qa-bug · qa-report *(the last four are Plan 2)*.
```

- [ ] **Step 3: Update the CHANGELOG**

In `CHANGELOG.md`, under the top/Unreleased section, add:
```markdown
### Added
- QA sidekick foundation: `.qa-agent/` casebook module (`src/casebook/`) with a
  stable case-id traceability backbone, `cases.md`/`state.json` parse-serialize,
  and I/O layer.
- `qa` router + `qa-plan` (criterio-driven planning with auditable scenario
  coverage + spec-gap findings) + `qa-author` (authors specs from the casebook).
- `scripts/check-casebook.mts` — validates a produced casebook exercises criterio.
```

- [ ] **Step 4: Final gate + commit**

Run: `pnpm check`
Expected: all green.

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document the QA sidekick + casebook foundation"
```

---

## Self-Review

**Spec coverage (against `2026-07-13-qa-sidekick-design.md`):**
- §2 architecture (suite + router + shared workspace) → Tasks 5–7 (skills) over Tasks 1–4 (casebook). ✓
- §3 workspace + traceability (case-id, `.qa-agent/` layout, format rule) → Tasks 1–4; layout in `casebookPaths`. ✓
- §4 criterio as engine (auditable scenario coverage, gaps.md first-class) → Task 5 skill + `check-casebook.mts` gate. ✓
- §5 stages: qa-plan (Task 5), qa-author (Task 7) covered here; qa-run/triage/bug/report → **Plan 2** (explicitly deferred, noted in router). ✓
- §6 router state machine → Task 6 + `state.ts` (Task 3). ✓
- §8 testing strategy (workspace I/O unit-tested; skills dogfooded on fixtures) → Tasks 1–4 unit tests; Tasks 5,7,8 dogfood. ✓
- §9 build order (workspace first) → Tasks ordered 1–4 then skills. ✓
- §10 open questions: `cases.md` schema pinned in Task 2; `explore` feeds qa-plan as an optional pass (Task 5 skill). Report JSON-vs-md → deferred to Plan 2. ✓

**Deferred to Plan 2 (documented, not gaps):** qa-run, qa-triage, qa-bug, qa-report and their artifacts (`runs/`, `flaky.json`, `findings/` automation) — their shapes depend on the schema locked here.

**Placeholder scan:** no TBD/TODO; every code and skill step has complete content. ✓

**Type consistency:** `TestCase`/`CasebookState`/`CyclePhase` names and signatures match across Tasks 2–4 and the interface summary; `casebookPaths` field names match between `store.ts` and its test and `check-casebook.mts`. ✓
