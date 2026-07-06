/** Runtime configuration for a single agent run. */
export interface RunConfig {
  /** Absolute path to the repo under test. All commands run with this as cwd. */
  repoPath: string;
  /**
   * Directories (relative to repoPath) the agent is allowed to write to.
   * Any change outside these is reverted by the workspace guard after each
   * command — this is how "app source is read-only" is actually enforced.
   */
  allowedWriteDirs: string[];
  /** Hard ceiling on loop iterations. */
  maxSteps: number;
  /** Per-command timeout in milliseconds. */
  commandTimeoutMs: number;
  /** Anthropic model id (via the Vercel AI SDK). */
  modelId: string;
  /** Command output longer than this (chars) is truncated before feeding back. */
  maxOutputChars: number;
  /** Quarantine: how many times each produced test is re-run to prove non-flaky. */
  reruns: number;
}

export const DEFAULT_CONFIG: Omit<RunConfig, "repoPath"> = {
  allowedWriteDirs: ["tests", "reports", ".qa-agent"],
  maxSteps: 40,
  commandTimeoutMs: 120_000,
  modelId: "claude-opus-4-8",
  maxOutputChars: 20_000,
  reruns: 3,
};

export function resolveConfig(repoPath: string, overrides: Partial<RunConfig> = {}): RunConfig {
  return { ...DEFAULT_CONFIG, repoPath, ...overrides };
}
