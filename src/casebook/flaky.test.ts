import { describe, expect, it } from "vitest";
import { emptyFlaky, parseFlaky, serializeFlaky, upsertFlaky } from "./flaky.js";

describe("parseFlaky / serializeFlaky", () => {
  it("round-trips", () => {
    const reg = upsertFlaky(emptyFlaky(), {
      spec: "tests/a.spec.ts",
      caseId: "TC-X-01",
      class: "flaky",
      note: "2/3 runs failed",
      updated: "2026-07-13T00:00:00.000Z",
    });
    expect(parseFlaky(serializeFlaky(reg))).toEqual(reg);
  });
  it("rejects an unknown class", () => {
    const raw = JSON.stringify({
      version: 1,
      entries: [{ spec: "s", class: "boom", note: "", updated: "t" }],
    });
    expect(() => parseFlaky(raw)).toThrow();
  });
});

describe("upsertFlaky", () => {
  it("replaces an existing entry for the same spec instead of duplicating", () => {
    let reg = upsertFlaky(emptyFlaky(), {
      spec: "tests/a.spec.ts",
      class: "flaky",
      note: "a",
      updated: "t1",
    });
    reg = upsertFlaky(reg, { spec: "tests/a.spec.ts", class: "locator-drift", note: "b", updated: "t2" });
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0]!.class).toBe("locator-drift");
    expect(reg.entries[0]!.note).toBe("b");
  });
});
