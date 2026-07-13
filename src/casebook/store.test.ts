import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendGap,
  casebookPaths,
  listFindings,
  readCases,
  readFlaky,
  readGaps,
  readLatestRun,
  readState,
  writeCases,
  writeFinding,
  writeFlaky,
  writePlan,
  writeRun,
  writeState,
} from "./store.js";
import { emptyState, setPhase } from "./state.js";
import { emptyFlaky, upsertFlaky } from "./flaky.js";
import type { TestCase } from "./cases.js";
import type { RunRecord } from "./run.js";

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
