import type { QATask } from "./schema.js";
import type { TaskRunResult } from "./runner.js";

/** Render a review-ready task result without requiring an external issue tracker. */
export function renderTaskReport(task: QATask, result: TaskRunResult): string {
  const lines = [
    `# QA task: ${result.taskId}`,
    "",
    `- **Status:** ${result.status} (${result.classification})`,
    `- **Goal:** ${result.goal}`,
    `- **Oracle:** ${task.oracle ?? "Missing"}`,
    `- **Reason:** ${result.reason}`,
    `- **Spec:** \`${result.spec}\``,
    ...(result.executionProfile === undefined
      ? []
      : [`- **Execution profile:** \`${result.executionProfile}\``]),
    ...(task.business === undefined
      ? []
      : [`- **Business flow:** ${task.business.flow} — ${task.business.capability}`]),
    ...(task.risk === undefined
      ? []
      : [`- **Risk:** ${task.risk.impact}×${task.risk.probability} (${task.risk.areas.join(", ")})`]),
    `- **Run:** ${result.runId}`,
    "",
    "## Attempts",
    "",
  ];
  for (const attempt of result.attempts) {
    lines.push(
      `- Attempt ${attempt.index}: ${attempt.passed ? "passed" : attempt.inconclusive ? "inconclusive" : "failed"} — [log](${attempt.outputFile})`,
    );
  }
  if (result.mutation !== undefined) {
    lines.push(
      "",
      "## Mutation proof",
      "",
      `- **Status:** ${result.mutation.status}`,
      `- ${result.mutation.reason}`,
    );
    for (const attempt of result.mutation.attempts) {
      lines.push(
        `- Attempt ${attempt.index}: ${attempt.passed ? "passed" : attempt.inconclusive ? "inconclusive" : "failed"} — [log](${attempt.outputFile})`,
      );
    }
  }
  lines.push("", "## Evidence", "");
  for (const attempt of result.attempts) {
    const evidence = attempt.evidence;
    if (evidence === undefined) continue;
    lines.push(
      `- Attempt ${attempt.index}: channels=${evidence.channels.join(", ")}; oracle reached=${evidence.oracleReached}; requests=${evidence.requestCount ?? "unknown"}; responses=${evidence.responses.length}; console events=${evidence.console.length}; page errors=${evidence.pageErrors.length}.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
