import { describe, expect, it } from "vitest";
import { underPrefix } from "./workspace.js";

describe("underPrefix", () => {
  it("returns the path unchanged when cwd is the git root (empty prefix)", () => {
    expect(underPrefix("tests/login.spec.ts", "")).toBe("tests/login.spec.ts");
  });

  it("strips the subdir prefix so paths become repo-relative", () => {
    expect(underPrefix("fixtures/login-app/tests/login.spec.ts", "fixtures/login-app/")).toBe(
      "tests/login.spec.ts",
    );
  });

  it("returns null for changes outside the cwd subtree (rest of a monorepo)", () => {
    expect(underPrefix("packages/other/src/app.ts", "fixtures/login-app/")).toBeNull();
  });

  it("normalizes backslash paths", () => {
    expect(underPrefix("fixtures\\login-app\\tests\\a.spec.ts", "fixtures/login-app/")).toBe(
      "tests/a.spec.ts",
    );
  });
});
