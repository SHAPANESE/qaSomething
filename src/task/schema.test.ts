import { describe, expect, it } from "vitest";
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
  });

  it("rejects unsafe task ids", () => {
    expect(() =>
      qaTaskSchema.parse({ version: 1, id: "../outside", goal: "x", spec: "tests/x.spec.ts" }),
    ).toThrow();
  });
});

describe("resolveTaskSpec", () => {
  it("keeps specs inside the repository", () => {
    expect(resolveTaskSpec("C:\\repo", "tests/login.spec.ts")).toBe("C:\\repo\\tests\\login.spec.ts");
    expect(() => resolveTaskSpec("C:\\repo", "..\\outside.spec.ts")).toThrow(/inside the repository/);
  });
});
