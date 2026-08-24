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

const RISK_SIGNALS: ReadonlyArray<{ risk: ActionRisk; pattern: RegExp }> = [
  { risk: "payment", pattern: /\b(pay(?:ment)?|checkout|purchase|stripe)\b/i },
  { risk: "external_message", pattern: /\b(send|message|email|sms|notify|webhook)\b/i },
  { risk: "user_admin", pattern: /\b(invite|admin|role|permission|delete[ -]?(?:user|account))\b/i },
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const URL_RE = /https?:\/\/[^\s"'`]+/gi;
const ROUTE_MUTATION_RE = /\b(?:page|context)\.route\s*\(/;
const SYNTHETIC_MUTATION_RE =
  /\b(?:expect\.fail|test\.fail|throw\s+new\s+Error)\b|expect\s*\(\s*false\s*\)\s*\.toBe\s*\(\s*true\s*\)/;

function allowedHosts(task: QATask): Set<string> {
  const hosts = new Set(LOOPBACK_HOSTS);
  if (task.target?.baseUrl !== undefined) {
    try {
      hosts.add(new URL(task.target.baseUrl).hostname.toLowerCase());
    } catch {
      // Task schema accepts a string; malformed target URLs are rejected later by Playwright.
    }
  }
  return hosts;
}

function codeViolations(
  task: QATask,
  actionId: string,
  declaredRisk: ActionRisk,
  code: string,
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  for (const signal of RISK_SIGNALS) {
    if (signal.pattern.test(code) && signal.risk !== declaredRisk) {
      violations.push({
        actionId,
        risk: signal.risk,
        reason: `Action ${actionId} appears to perform ${signal.risk} but is classified as ${declaredRisk}.`,
      });
    }
  }

  const hosts = allowedHosts(task);
  for (const rawUrl of code.match(URL_RE) ?? []) {
    try {
      const url = new URL(rawUrl);
      if (!hosts.has(url.hostname.toLowerCase())) {
        violations.push({
          actionId,
          risk: "external_message",
          reason: `Action ${actionId} targets non-local host ${url.hostname}, which is outside the task target.`,
        });
      }
    } catch {
      // An incomplete literal is syntax-invalid Playwright code and will fail verification.
    }
  }
  return violations;
}

/** Mechanical policy evaluation. Explicit deny always wins over allow. */
export function evaluateSafety(task: QATask, sequence: TaskSequence): SafetyViolation[] {
  const allowed = new Set<ActionRisk>(task.safety?.allow ?? DEFAULT_ALLOWED);
  const denied = new Set<ActionRisk>(task.safety?.deny ?? ["external_message", "payment", "user_admin"]);
  const violations: SafetyViolation[] = [];
  const evaluateRisk = (actionId: string, risk: ActionRisk, code: string): void => {
    if (denied.has(risk)) {
      violations.push({
        actionId,
        risk,
        reason: `Action ${actionId} is explicitly denied (${risk}).`,
      });
    } else if (!allowed.has(risk)) {
      violations.push({
        actionId,
        risk,
        reason: `Action ${actionId} is not in the task allowlist (${risk}).`,
      });
    }
    violations.push(...codeViolations(task, actionId, risk, code));
  };
  for (const action of sequence.actions) {
    evaluateRisk(action.id, action.risk, `${action.intent}\n${action.code}`);
  }
  for (const action of sequence.cleanup ?? []) {
    evaluateRisk(`cleanup:${action.id}`, action.risk, `${action.intent}\n${action.code}`);
  }
  if (sequence.mutation !== undefined)
    evaluateRisk(
      "mutation",
      sequence.mutation.risk,
      `${sequence.mutation.intent}\n${sequence.mutation.code}`,
    );
  if (sequence.mutation !== undefined && !ROUTE_MUTATION_RE.test(sequence.mutation.code)) {
    violations.push({
      actionId: "mutation",
      risk: sequence.mutation.risk,
      reason: "Mutation setup must change app-boundary behavior with page.route() or context.route().",
    });
  }
  if (sequence.mutation !== undefined && SYNTHETIC_MUTATION_RE.test(sequence.mutation.code)) {
    violations.push({
      actionId: "mutation",
      risk: sequence.mutation.risk,
      reason: "Mutation setup must not force a synthetic test failure.",
    });
  }
  // Assertions are executable code too. They cannot be used to bypass the action policy.
  violations.push(
    ...codeViolations(task, "assertion", "read", `${sequence.assertion.intent}\n${sequence.assertion.code}`),
  );
  return violations;
}
