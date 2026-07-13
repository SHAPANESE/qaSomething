import { describe, expect, it } from "vitest";
import { parseCaseTag } from "./caseTag.js";

describe("parseCaseTag", () => {
  it("reads the case id from a leading // case: comment", () => {
    expect(parseCaseTag("// case: TC-PROJ-42-04\nimport { test } from '@playwright/test';")).toBe(
      "TC-PROJ-42-04",
    );
  });
  it("tolerates extra spacing", () => {
    expect(parseCaseTag("//   case:   TC-X-01")).toBe("TC-X-01");
  });
  it("returns null when there is no tag", () => {
    expect(parseCaseTag("import { test } from '@playwright/test';")).toBeNull();
  });
  it("only matches a well-formed id", () => {
    expect(parseCaseTag("// case: nope")).toBeNull();
  });
});
