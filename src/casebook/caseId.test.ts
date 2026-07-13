import { describe, expect, it } from "vitest";
import { makeCaseId, nextCaseNumber, parseCaseId } from "./caseId.js";

describe("makeCaseId", () => {
  it("formats as TC-<TICKET>-NN with zero padding and an uppercase slug", () => {
    expect(makeCaseId("proj-12", 3)).toBe("TC-PROJ-12-03");
    expect(makeCaseId("JIRA_99", 12)).toBe("TC-JIRA-99-12");
  });
  it("collapses non-alphanumerics into single dashes and trims them", () => {
    expect(makeCaseId("  Sign up flow! ", 1)).toBe("TC-SIGN-UP-FLOW-01");
  });
});

describe("parseCaseId", () => {
  it("round-trips a made id", () => {
    expect(parseCaseId("TC-PROJ-12-03")).toEqual({ ticket: "PROJ-12", n: 3 });
  });
  it("returns null for non-matching ids", () => {
    expect(parseCaseId("nope")).toBeNull();
    expect(parseCaseId("TC-X-1")).toBeNull(); // needs >= 2 digits
  });
});

describe("nextCaseNumber", () => {
  it("returns 1 when no existing ids match the ticket", () => {
    expect(nextCaseNumber([], "PROJ-12")).toBe(1);
    expect(nextCaseNumber(["TC-OTHER-05"], "PROJ-12")).toBe(1);
  });
  it("returns max+1 across matching ids only", () => {
    expect(nextCaseNumber(["TC-PROJ-12-01", "TC-PROJ-12-04", "TC-OTHER-09"], "proj-12")).toBe(5);
  });
});
