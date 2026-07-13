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
