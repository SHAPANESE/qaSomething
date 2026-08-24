import { describe, expect, it } from "vitest";
import { rankByRisk } from "./risk.js";

describe("rankByRisk", () => {
  it("orders high-impact/high-probability tasks first", () => {
    const ranked = rankByRisk([
      { id: "copy", risk: { impact: 1, probability: 1, areas: ["copy"] } },
      { id: "payment", risk: { impact: 5, probability: 5, areas: ["payments"] } },
      { id: "login", risk: { impact: 5, probability: 3, areas: ["auth"] } },
    ]);
    expect(ranked.map((entry) => entry.item.id)).toEqual(["payment", "login", "copy"]);
  });
});
