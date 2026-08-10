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
});
