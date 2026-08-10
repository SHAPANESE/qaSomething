import { describe, expect, it } from "vitest";
import { shrinkSequence } from "./shrinker.js";
import type { TaskSequence } from "./sequence.js";

const sequence: TaskSequence = {
  version: 1,
  taskId: "duplicate",
  title: "does not duplicate",
  actions: [
    { id: "login", intent: "Login", code: "login()", required: true, risk: "read" },
    { id: "open-help", intent: "Open help", code: "help()", required: false, risk: "read" },
    { id: "fill", intent: "Fill title", code: "fill()", required: false, risk: "modify_test_data" },
    {
      id: "double-submit",
      intent: "Submit twice",
      code: "submit()",
      required: false,
      risk: "create_test_data",
    },
  ],
  assertion: { intent: "Only one item exists", code: "assertOne()" },
};

describe("shrinkSequence", () => {
  it("removes irrelevant actions while preserving required setup and the reproducer", async () => {
    const result = await shrinkSequence(sequence, async (candidate) => {
      const ids = candidate.actions.map((action) => action.id);
      return ids.includes("login") && ids.includes("fill") && ids.includes("double-submit");
    });
    expect(result.sequence.actions.map((action) => action.id)).toEqual(["login", "fill", "double-submit"]);
    expect(result.removedActionIds).toEqual(["open-help"]);
    expect(result.attempts).toBeGreaterThan(0);
  });

  it("never removes required actions", async () => {
    const result = await shrinkSequence(sequence, async () => true);
    expect(result.sequence.actions.map((action) => action.id)).toContain("login");
  });
});
