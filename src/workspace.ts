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

  const changes = parsePorcelain(String(status.stdout));
  const disallowed = changes.filter((c) => !isAllowed(c.path, allowedDirs));
  if (disallowed.length === 0) return [];

  const untracked = disallowed.filter((c) => c.untracked).map((c) => c.path);
  const tracked = disallowed.filter((c) => !c.untracked).map((c) => c.path);

  if (tracked.length > 0) {
    await execa("git", ["checkout", "--", ...tracked], { cwd, reject: false });
  }
  for (const file of untracked) {
    await rm(path.join(cwd, file), { force: true, recursive: true });
  }

  return disallowed.map((c) => c.path);
}
