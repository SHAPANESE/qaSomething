import { describe, expect, it } from "vitest";
import { evaluateSafety } from "./safety.js";
import type { QATask } from "./schema.js";
import type { TaskSequence } from "./sequence.js";

const baseTask: QATask = { version: 1, id: "safe", goal: "Explore safely", attempts: 2 };

function sequence(risk: TaskSequence["actions"][number]["risk"]): TaskSequence {
  return {
    version: 1,
    taskId: "safe",
    title: "safe task",
    actions: [{ id: "action", intent: "Do it", code: "doIt()", required: false, risk }],
    assertion: { intent: "It worked", code: "assertIt()" },
  };
}

describe("evaluateSafety", () => {
  it("allows local test-data operations by default", () => {
    expect(evaluateSafety(baseTask, sequence("create_test_data"))).toEqual([]);
    expect(evaluateSafety(baseTask, sequence("delete_test_data"))).toEqual([]);
  });

  it("blocks external side effects by default", () => {
    expect(evaluateSafety(baseTask, sequence("payment"))[0]?.reason).toContain("denied");
    expect(evaluateSafety(baseTask, sequence("external_message"))).toHaveLength(1);
  });

  it("lets explicit deny override explicit allow", () => {
    const task: QATask = {
      ...baseTask,
      safety: { allow: ["read", "payment"], deny: ["payment"] },
    };
    expect(evaluateSafety(task, sequence("payment"))).toHaveLength(1);
  });

  it("rejects code whose side effect is misclassified", () => {
    const unsafe = sequence("read");
    unsafe.actions[0]!.code = 'await page.getByRole("button", { name: "Send" }).click()';
    expect(evaluateSafety(baseTask, unsafe)[0]?.reason).toContain("external_message");
  });

  it("allows only local and configured-target literal URLs", () => {
    const task: QATask = { ...baseTask, target: { baseUrl: "https://staging.example.test" } };
    const safe = sequence("read");
    safe.actions[0]!.code = 'await page.goto("https://staging.example.test/login")';
    expect(evaluateSafety(task, safe)).toEqual([]);

    safe.actions[0]!.code = 'await page.goto("https://outside.example.test")';
    expect(evaluateSafety(task, safe)[0]?.reason).toContain("outside the task target");
  });

  it("screens assertion code as well as action code", () => {
    const unsafe = sequence("read");
    unsafe.assertion.code = 'await fetch("https://outside.example.test/report")';
    expect(evaluateSafety(baseTask, unsafe)[0]?.actionId).toBe("assertion");
  });

  it("applies the task policy to mutation setup", () => {
    const unsafe = sequence("read");
    unsafe.mutation = {
      intent: "Send a receipt",
      code: 'await page.getByText("Send").click()',
      risk: "read",
    };
    expect(evaluateSafety(baseTask, unsafe)[0]?.actionId).toBe("mutation");
  });

  it("requires an app-boundary mutation instead of a synthetic failure", () => {
    const unsafe = sequence("read");
    unsafe.mutation = { intent: "Force a failure", code: 'throw new Error("mutated")', risk: "read" };
    const reasons = evaluateSafety(baseTask, unsafe).map((violation) => violation.reason);
    expect(reasons).toContain(
      "Mutation setup must change app-boundary behavior with page.route() or context.route().",
    );
    expect(reasons).toContain("Mutation setup must not force a synthetic test failure.");
  });
});
