/** Core domain types for the QA agent engine. */

export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

/**
 * The result of parsing an assistant turn. The agent must emit exactly one
 * action per turn: either a shell command to run, or a `finish` signal that
 * ends the mission with a summary. Anything else is a protocol violation the
 * loop surfaces back to the model so it can correct itself.
 */
export type ParsedAction =
  | { kind: "command"; command: string }
  | { kind: "finish"; summary: string }
  | { kind: "none"; reason: string };

/** Outcome of running a single shell command under the guardrails. */
export interface CommandResult {
  command: string;
  /** True when the guardrails blocked the command before execution. */
  blocked: boolean;
  /** Populated when `blocked` is true. */
  blockReason?: string;
  stdout: string;
  stderr: string;
  /** Null when the command was blocked or timed out before exiting. */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Files reverted by the workspace guard because they fell outside the write allowlist. */
  revertedPaths: string[];
}

/** A single iteration of the agent loop. */
export interface Step {
  index: number;
  /** Raw assistant text for this turn (thinking + action). */
  assistant: string;
  action: ParsedAction;
  /** Present only when `action.kind === "command"`. */
  result?: CommandResult;
}

export interface RunResult {
  finished: boolean;
  /** Set when the agent emitted a `finish` action. */
  summary?: string;
  steps: Step[];
  stepCount: number;
  /** Reason the run stopped without a clean finish (step limit, fatal error). */
  stoppedReason?: string;
}
