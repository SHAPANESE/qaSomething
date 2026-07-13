import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendGap,
  casebookPaths,
  readCases,
  readState,
  writeCases,
  writePlan,
  writeState,
} from "./store.js";
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
