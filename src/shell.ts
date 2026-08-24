import { execa } from "execa";
import { existsSync } from "node:fs";
import type { CommandResult } from "./types.js";

export interface BlocklistRule {
  pattern: RegExp;
  reason: string;
}

/**
 * Static screening layer. This is NOT a sandbox — it is a cheap first line of
 * defence that rejects obviously destructive or exfiltrating commands before
 * they run. Real isolation (container, network egress control) and the
 * filesystem write-allowlist (git-revert guard in workspace.ts) are the
 * layers that actually contain the agent. Screening just stops the worst.
 */
export const DEFAULT_BLOCKLIST: BlocklistRule[] = [
  {
    pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r)\b/i,
    reason: "Recursive force-delete (rm -rf) is forbidden.",
  },
  { pattern: /\b(mkfs|fdisk|parted)\b/i, reason: "Disk formatting/partitioning is forbidden." },
  { pattern: /\bdd\s+.*\bof=\/dev\//i, reason: "Raw disk write via dd is forbidden." },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "Power/state commands are forbidden." },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, reason: "Fork bomb detected." },
  { pattern: /\bsudo\b/i, reason: "Privilege escalation (sudo) is forbidden." },
  { pattern: /\bgit\s+push\b/i, reason: "Pushing to a remote is forbidden — the agent works locally only." },
  { pattern: /\b(npm|pnpm|yarn)\s+publish\b/i, reason: "Publishing packages is forbidden." },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "Recursive world-writable chmod is forbidden." },
  { pattern: /\b(crontab|at)\s/i, reason: "Scheduling commands is forbidden." },
  { pattern: /\bkillall\b|\bkill\s+-9\s+-1\b/i, reason: "Mass process kill is forbidden." },
  {
    pattern: /\b(?:Remove-Item|rmdir|rd|del)\b[^\n]*(?:-Recurse|\/s)\b/i,
    reason: "Recursive delete is forbidden.",
  },
  {
    pattern: /\bgit\s+(?:clone|fetch|pull|ls-remote)\b/i,
    reason: "Fetching from remotes is forbidden â€” the agent works locally only.",
  },
  {
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:install|add|i)\b/i,
    reason: "Installing packages is forbidden during an agent run. Prepare dependencies before starting.",
  },
];

const URL_RE = /https?:\/\/([^\s/"']+)/gi;
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|host\.docker\.internal)(:\d+)?$/i;

export interface ScreenResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a command is allowed to run. Literal URLs are permitted only
 * against local hosts, regardless of whether they appear in curl, Node, Python,
 * or another interpreter. This keeps simple alternate-client tricks from
 * bypassing the local-app boundary.
 */
export function screenCommand(command: string, blocklist: BlocklistRule[] = DEFAULT_BLOCKLIST): ScreenResult {
  for (const rule of blocklist) {
    if (rule.pattern.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  for (const match of command.matchAll(URL_RE)) {
    const host = match[1] ?? "";
    if (!LOCAL_HOSTS.test(host)) {
      return {
        allowed: false,
        reason: `Network access to non-local host "${host}" is forbidden. The agent may only reach the local app-under-test.`,
      };
    }
  }

  return { allowed: true };
}

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  blocklist?: BlocklistRule[];
}

export function resolveBashBinary(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (env["QA_AGENT_BASH"]) return env["QA_AGENT_BASH"];
  if (platform !== "win32") return "bash";
  const candidates = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"];
  return candidates.find((candidate) => existsSync(candidate)) ?? "bash";
}

/**
 * Screen, then execute a shell command via `bash -c`. Never throws on a
 * non-zero exit — the failure is data the agent needs to see. A blocked
 * command returns immediately without executing.
 */
export async function runCommand(command: string, options: RunCommandOptions): Promise<CommandResult> {
  const screen = screenCommand(command, options.blocklist);
  if (!screen.allowed) {
    return {
      command,
      blocked: true,
      blockReason: screen.reason ?? "Command blocked by guardrails.",
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      revertedPaths: [],
    };
  }

  const started = process.hrtime.bigint();
  const result = await execa(resolveBashBinary(), ["-c", command], {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    reject: false,
    all: false,
    stripFinalNewline: false,
    ...(options.env ? { env: options.env, extendEnv: true } : {}),
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;

  return {
    command,
    blocked: false,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
    timedOut: result.timedOut === true,
    durationMs,
    revertedPaths: [],
  };
}
