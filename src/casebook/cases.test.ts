import { describe, expect, it } from "vitest";
import { parseCases, serializeCases, type TestCase } from "./cases.js";

const sample: TestCase[] = [
  {
    id: "TC-PROJ-12-01",
    ac: "AC-1: valid credentials log the user in",
    priority: "high",
    category: "happy",
    status: "planned",
    spec: "tests/login.spec.ts",
    description: "Given valid credentials, submitting logs in and lands on /home.",
  },
  {
    id: "TC-PROJ-12-02",
    ac: "AC-2: empty email is rejected",
    priority: "high",
    category: "negative",
    status: "planned",
    description: "Submitting with an empty email shows an inline error and does not call the API.",
  },
];

describe("serializeCases / parseCases", () => {
  it("round-trips cases through markdown", () => {
    const md = serializeCases(sample);
    expect(parseCases(md)).toEqual(sample);
  });

  it("omits the spec key when a case has no spec", () => {
    const md = serializeCases([sample[1]!]);
    expect(md).not.toContain("spec:");
    const back = parseCases(md);
    expect(back[0]).not.toHaveProperty("spec");
  });

  it("parses a hand-written cases.md block", () => {
    const md = [
      "---",
      "id: TC-X-01",
      'ac: "AC: boundary — 256-char name"',
      "priority: medium",
      "category: boundary",
      "status: planned",
      "---",
      "A name at the max length saves; one over shows a length error.",
      "",
    ].join("\n");
    const cases = parseCases(md);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.category).toBe("boundary");
    expect(cases[0]!.ac).toBe("AC: boundary — 256-char name");
  });

  it("rejects an invalid category via the schema", () => {
    const md = [
      "---",
      "id: TC-X-01",
      "ac: x",
      "priority: low",
      "category: bogus",
      "status: planned",
      "---",
      "body",
      "",
    ].join("\n");
    expect(() => parseCases(md)).toThrow();
  });

  it("returns [] for empty input", () => {
    expect(parseCases("")).toEqual([]);
  });
});
