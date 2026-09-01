import { describe, expect, it } from "vitest";
import path from "node:path";
import { qaTaskSchema, resolveTaskSpec } from "./schema.js";

describe("qaTaskSchema", () => {
  it("applies a safe default attempt count", () => {
    const task = qaTaskSchema.parse({
      version: 1,
      id: "login",
      goal: "Test login",
    });
    expect(task.attempts).toBe(2);
    expect(task.spec).toBeUndefined();
    expect(task.mutationSpec).toBeUndefined();
  });

  it("rejects unsafe task ids", () => {
    expect(() =>
      qaTaskSchema.parse({ version: 1, id: "../outside", goal: "x", spec: "tests/x.spec.ts" }),
    ).toThrow();
  });

  it("accepts a sibling mutation spec", () => {
    const task = qaTaskSchema.parse({
      version: 1,
      id: "login",
      goal: "Test login",
      spec: "tests/login.spec.ts",
      mutationSpec: "tests/login.mutation.spec.ts",
    });
    expect(task.mutationSpec).toBe("tests/login.mutation.spec.ts");
  });

  it("accepts a structured input-value oracle", () => {
    const task = qaTaskSchema.parse({
      version: 1,
      id: "todo-create",
      goal: "Create a todo",
      oracleChecks: [{ kind: "input_value", selector: 'input[value="QA todo"]', value: "QA todo" }],
    });
    expect(task.oracleChecks).toEqual([
      { kind: "input_value", selector: 'input[value="QA todo"]', value: "QA todo" },
    ]);
  });

  it("captures business intent, execution projects, and a request budget", () => {
    const task = qaTaskSchema.parse({
      version: 1,
      id: "checkout-total",
      goal: "Verify checkout total",
      business: { flow: "checkout", capability: "Order total", tags: ["money"] },
      execution: { projects: ["chromium", "Mobile Chrome"] },
      safety: { maxRequests: 40 },
    });
    expect(task.business?.flow).toBe("checkout");
    expect(task.execution?.projects).toContain("Mobile Chrome");
    expect(task.safety?.maxRequests).toBe(40);
  });

  it("accepts an explicit supervised execution policy", () => {
    const task = qaTaskSchema.parse({
      version: 1,
      id: "checkout-total",
      goal: "Verify checkout total",
      supervision: {
        mode: "approve_risky",
        checkpointBeforeExecution: true,
        checkpointBeforeFinding: true,
        reviewer: "qa@example.test",
      },
    });

    expect(task.supervision).toEqual({
      mode: "approve_risky",
      checkpointBeforeExecution: true,
      checkpointBeforeFinding: true,
      reviewer: "qa@example.test",
    });
  });
});

describe("resolveTaskSpec", () => {
  it("keeps specs inside the repository", () => {
    const repo = path.resolve("repo");
    expect(resolveTaskSpec(repo, path.join("tests", "login.spec.ts"))).toBe(
      path.join(repo, "tests", "login.spec.ts"),
    );
    expect(() => resolveTaskSpec(repo, path.join("..", "outside.spec.ts"))).toThrow(/inside the repository/);
  });
});
