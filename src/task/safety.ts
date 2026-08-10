import type { QATask } from "./schema.js";
import type { TaskSequence } from "./sequence.js";

export type ActionRisk = TaskSequence["actions"][number]["risk"];

const DEFAULT_ALLOWED: ReadonlySet<ActionRisk> = new Set([
  "read",
  "create_test_data",
  "modify_test_data",
  "delete_test_data",
]);

export interface SafetyViolation {
  actionId: string;
  risk: ActionRisk;
  reason: string;
}

/** Mechanical policy evaluation. Explicit deny always wins over allow. */
export function evaluateSafety(task: QATask, sequence: TaskSequence): SafetyViolation[] {
  const allowed = new Set<ActionRisk>(task.safety?.allow ?? DEFAULT_ALLOWED);
  const denied = new Set<ActionRisk>(task.safety?.deny ?? ["external_message", "payment", "user_admin"]);
  const violations: SafetyViolation[] = [];
  for (const action of sequence.actions) {
    if (denied.has(action.risk)) {
      violations.push({
        actionId: action.id,
        risk: action.risk,
        reason: `Action ${action.id} is explicitly denied (${action.risk}).`,
      });
    } else if (!allowed.has(action.risk)) {
      violations.push({
        actionId: action.id,
        risk: action.risk,
        reason: `Action ${action.id} is not in the task allowlist (${action.risk}).`,
      });
    }
  }
  return violations;
}
