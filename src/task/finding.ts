import type { TaskStatus } from "./runner.js";
import type { QATask } from "./schema.js";

export type FindingClassification =
  "verified" | "confirmed_bug" | "probable_bug" | "blocked" | "environment_issue" | "insufficient_evidence";

export function classifyFinding(task: QATask, status: TaskStatus, reason: string): FindingClassification {
  if (status === "passed") return "verified";
  if (status === "blocked") return "blocked";
  if (status === "inconclusive") {
    return /evidence|mutat|oracle/i.test(reason) ? "insufficient_evidence" : "environment_issue";
  }
  return task.oracle !== undefined ? "confirmed_bug" : "probable_bug";
}
