import { execa } from "execa";
import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Filesystem write-allowlist enforcement, backed by git.
 *
 * The static command screen (shell.ts) can't tell "wrote a test file" from
 * "edited the app to make the test pass". This guard can: after every command
 * it asks git what changed, and reverts anything outside the allowed write
 * directories — restoring tracked files and deleting stray untracked ones.
 *
 * This is the layer that makes "app source is read-only" a fact rather than a
 * hope. It requires the repo under test to be a git repo; when it isn't, the
 * guard is a no-op and the caller is expected to warn loudly.
 */

export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await execa("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    reject: false,
  });
  return res.exitCode === 0 && String(res.stdout).trim() === "true";
}

/**
 * The path of `cwd` relative to the git root (e.g. "fixtures/login-app/", or ""
 * when cwd IS the root). `git status --porcelain` reports paths from the ROOT
 * regardless of cwd, so we need this to translate them back to repo-relative.
 */
export async function gitPrefix(cwd: string): Promise<string> {
  const res = await execa("git", ["rev-parse", "--show-prefix"], { cwd, reject: false });
  if (res.exitCode !== 0) return "";
  return String(res.stdout).trim();
}

/**
 * Pure: given a repo-root-relative git path and the cwd's prefix, return the
 * path relative to cwd — or null if it falls outside cwd's subtree (elsewhere in
 * the monorepo, which the guard must leave untouched).
 */
export function underPrefix(gitPath: string, prefix: string): string | null {
  const p = gitPath.split("\\").join("/");
  const pre = prefix.split("\\").join("/");
  if (pre === "") return p;
  if (!p.startsWith(pre)) return null;
  return p.slice(pre.length);
}

function isAllowed(relPath: string, allowedDirs: string[]): boolean {
  const normalized = relPath.split(path.sep).join("/");
  return allowedDirs.some(
    (dir) => normalized === dir || normalized.startsWith(dir.replace(/\/$/, "") + "/"),
  );
}

interface GitChange {
  path: string;
  untracked: boolean;
}

function parsePorcelain(output: string): GitChange[] {
  const changes: GitChange[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    let file = line.slice(3).trim();
    // Renames appear as "old -> new"; the new path is what exists on disk.
    const arrow = file.indexOf(" -> ");
    if (arrow !== -1) file = file.slice(arrow + 4);
    // Strip surrounding quotes git adds for paths with special chars.
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    changes.push({ path: file, untracked: status === "??" });
  }
  return changes;
}

/**
 * List repo-relative paths that changed (tracked modifications + untracked new
 * files) since the last commit. Used after a run to find the tests the agent
 * produced so the harness can verify them.
 */
export async function listChangedPaths(cwd: string): Promise<string[]> {
  const status = await execa("git", ["status", "--porcelain"], { cwd, reject: false });
  if (status.exitCode !== 0) return [];
  const prefix = await gitPrefix(cwd);
  return parsePorcelain(String(status.stdout))
    .map((c) => underPrefix(c.path, prefix))
    .filter((p): p is string => p !== null);
}

/**
 * Revert every change that falls outside `allowedDirs`. Returns the list of
 * paths that were reverted so the caller can surface the guardrail action back
 * to the agent (it needs to know its edit was undone and why).
 */
export async function revertDisallowedChanges(
  cwd: string,
  allowedDirs: string[],
): Promise<string[]> {
  const status = await execa("git", ["status", "--porcelain"], { cwd, reject: false });
  if (status.exitCode !== 0) return [];

  const prefix = await gitPrefix(cwd);
  const disallowed: { rel: string; untracked: boolean }[] = [];
  for (const change of parsePorcelain(String(status.stdout))) {
    const rel = underPrefix(change.path, prefix);
    // Skip changes outside cwd's subtree — never touch the rest of a monorepo.
    if (rel === null) continue;
    if (isAllowed(rel, allowedDirs)) continue;
    disallowed.push({ rel, untracked: change.untracked });
  }
  if (disallowed.length === 0) return [];

  const untracked = disallowed.filter((c) => c.untracked).map((c) => c.rel);
  const tracked = disallowed.filter((c) => !c.untracked).map((c) => c.rel);

  if (tracked.length > 0) {
    await execa("git", ["checkout", "--", ...tracked], { cwd, reject: false });
  }
  for (const file of untracked) {
    await rm(path.join(cwd, file), { force: true, recursive: true });
  }

  return disallowed.map((c) => c.rel);
}
