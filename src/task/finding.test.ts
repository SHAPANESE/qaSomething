import { describe, expect, it } from "vitest";
import { classifyFinding } from "./finding.js";
import type { QATask } from "./schema.js";

const task: QATask = { version: 1, id: "t", goal: "test", attempts: 2 };

describe("classifyFinding", () => {
  it("requires an oracle for a confirmed bug", () => {
    expect(classifyFinding(task, "failed", "failed twice")).toBe("probable_bug");
    expect(classifyFinding({ ...task, oracle: "Exactly one item" }, "failed", "failed twice")).toBe(
      "confirmed_bug",
    );
  });

  it("keeps environment, evidence, and safety outcomes distinct", () => {
    expect(classifyFinding(task, "inconclusive", "environment failed")).toBe("environment_issue");
    expect(classifyFinding(task, "inconclusive", "Required ui evidence was not captured")).toBe(
      "insufficient_evidence",
    );
    expect(classifyFinding(task, "blocked", "payment denied")).toBe("blocked");
  });
});
