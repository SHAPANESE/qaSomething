import { describe, expect, it } from "vitest";
import { emptyState, nextPhase, parseState, serializeState, setPhase } from "./state.js";

describe("nextPhase", () => {
  it("advances through the cycle and stops at the end", () => {
    expect(nextPhase("planned")).toBe("authored");
    expect(nextPhase("triaged")).toBe("reported");
    expect(nextPhase("reported")).toBeNull();
  });
});

describe("setPhase", () => {
  it("records a ticket's phase without mutating the input", () => {
    const s0 = emptyState();
    const s1 = setPhase(s0, "PROJ-12", "planned", "2026-07-13T00:00:00.000Z");
    expect(s0.tickets).toEqual({});
    expect(s1.tickets["PROJ-12"]).toEqual({
      ticketId: "PROJ-12",
      phase: "planned",
      updated: "2026-07-13T00:00:00.000Z",
    });
  });
});

describe("parseState / serializeState", () => {
  it("round-trips", () => {
    const s = setPhase(emptyState(), "PROJ-12", "authored", "2026-07-13T00:00:00.000Z");
    expect(parseState(serializeState(s))).toEqual(s);
  });
  it("rejects an unknown phase", () => {
    const raw = JSON.stringify({
      version: 1,
      tickets: { X: { ticketId: "X", phase: "nope", updated: "t" } },
    });
    expect(() => parseState(raw)).toThrow();
  });
});
