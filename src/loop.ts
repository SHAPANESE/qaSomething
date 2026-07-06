import type { RunConfig } from "./config.js";
import type { Model } from "./model.js";
import { parseAction } from "./parse.js";
import { buildMissionPrompt, buildSystemPrompt } from "./prompt.js";
import { runCommand } from "./shell.js";
import type { CommandResult, Message, RunResult, Step } from "./types.js";
import { isGitRepo, revertDisallowedChanges } from "./workspace.js";

export interface RunAgentArgs {
  model: Model;
  mission: string;
  criteriaManual: string;
  config: RunConfig;
  /** Source-of-truth block (from a ticket) injected into the mission. */
  oracle?: string;
  /** Optional hook fired after each step, for CLI progress rendering. */
  onStep?: (step: Step) => void;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n...[truncated ${text.length - max} chars]...\n${text.slice(text.length - tail)}`;
}

/** Render a command result into the observation text fed back to the model. */
export function formatObservation(result: CommandResult, maxChars: number): string {
  if (result.blocked) {
    return `[BLOCKED by guardrails] ${result.blockReason}\nThe command did not run. Choose a different approach.`;
  }
  const parts: string[] = [];
  parts.push(result.timedOut ? `[timed out after ${Math.round(result.durationMs)}ms]` : `[exit ${result.exitCode}]`);
  if (result.revertedPaths.length > 0) {
    parts.push(
      `[GUARDRAIL] Reverted changes outside the write allowlist: ${result.revertedPaths.join(", ")}. ` +
        `App source is read-only — if the app is buggy, report it as a finding instead of editing it.`,
    );
  }
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  parts.push(stdout ? `stdout:\n${stdout}` : "stdout: <empty>");
  if (stderr) parts.push(`stderr:\n${stderr}`);
  return truncate(parts.join("\n\n"), maxChars);
}

/**
 * The agent loop. Mirrors mini-swe-agent / Webwright: the model emits one shell
 * command per turn, we run it under the guardrails, and feed the observation
 * back — until the agent finishes or we hit the step ceiling.
 */
export async function runAgent(args: RunAgentArgs): Promise<RunResult> {
  const { model, mission, criteriaManual, config, oracle, onStep } = args;

  const system = buildSystemPrompt(criteriaManual, config);
  const messages: Message[] = [{ role: "user", content: buildMissionPrompt(mission, config, oracle) }];
  const steps: Step[] = [];

  const gitBacked = await isGitRepo(config.repoPath);
  if (!gitBacked) {
    messages.push({
      role: "user",
      content:
        "[SETUP WARNING] The repo under test is not a git repository, so the " +
        "filesystem write-guard cannot enforce the read-only rule. Be extra careful " +
        "to write only inside the allowed directories.",
    });
  }

  for (let index = 0; index < config.maxSteps; index++) {
    const assistant = await model.generate(system, messages);
    messages.push({ role: "assistant", content: assistant });
    const action = parseAction(assistant);

    if (action.kind === "finish") {
      const step: Step = { index, assistant, action };
      steps.push(step);
      onStep?.(step);
      return { finished: true, summary: action.summary, steps, stepCount: steps.length };
    }

    if (action.kind === "none") {
      const step: Step = { index, assistant, action };
      steps.push(step);
      onStep?.(step);
      messages.push({
        role: "user",
        content: `[PROTOCOL] ${action.reason} Emit exactly one \`\`\`bash command, or a \`\`\`done block to finish.`,
      });
      continue;
    }

    const result = await runCommand(action.command, {
      cwd: config.repoPath,
      timeoutMs: config.commandTimeoutMs,
    });
    if (gitBacked && !result.blocked) {
      result.revertedPaths = await revertDisallowedChanges(config.repoPath, config.allowedWriteDirs);
    }

    const step: Step = { index, assistant, action, result };
    steps.push(step);
    onStep?.(step);
    messages.push({ role: "user", content: formatObservation(result, config.maxOutputChars) });
  }

  return {
    finished: false,
    steps,
    stepCount: steps.length,
    stoppedReason: `Reached the step limit (${config.maxSteps}) without finishing.`,
  };
}
