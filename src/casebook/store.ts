import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCases, serializeCases, type TestCase } from "./cases.js";
import { emptyState, parseState, serializeState, type CasebookState } from "./state.js";
import { parseRun, serializeRun, type RunRecord } from "./run.js";
import { emptyFlaky, parseFlaky, serializeFlaky, type FlakyRegistry } from "./flaky.js";

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
  report: string;
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
    report: path.join(dir, "report.md"),
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

export async function writeReport(repo: string, markdown: string): Promise<void> {
  await ensureCasebook(repo);
  await writeFile(casebookPaths(repo).report, markdown, "utf8");
}
