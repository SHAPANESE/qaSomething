import { describe, expect, it } from "vitest";
import { FROZEN_EVENTS, INTERACTION_FREEZE } from "./mutate.js";

describe("INTERACTION_FREEZE", () => {
  it("blocks the key user-interaction events", () => {
    for (const type of ["click", "submit", "input", "change", "keydown"]) {
      expect(FROZEN_EVENTS).toContain(type);
      expect(INTERACTION_FREEZE).toContain(type);
    }
  });

  it("intercepts in the capture phase and prevents default", () => {
    expect(INTERACTION_FREEZE).toContain("capture: true");
    expect(INTERACTION_FREEZE).toContain("stopImmediatePropagation");
    expect(INTERACTION_FREEZE).toContain("preventDefault");
  });

  it("is a self-invoking script safe to pass to addInitScript", () => {
    expect(INTERACTION_FREEZE.trim().startsWith("(()")).toBe(true);
    // Not a smoke check: it must actually reference addEventListener to install.
    expect(INTERACTION_FREEZE).toContain("addEventListener");
  });
});
