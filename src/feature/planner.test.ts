import { describe, expect, it } from "vitest";
import type { Model } from "../model.js";
import { planFeature } from "./planner.js";
import { featureSchema } from "./schema.js";

class StaticModel implements Model {
  readonly id = "static";
  calls = 0;

  constructor(private readonly outputs: string[]) {}

  async generate(): Promise<string> {
    return this.outputs[this.calls++] ?? "";
  }
}

const feature = featureSchema.parse({
  version: 1,
  id: "profile-name",
  goal: "Edit a profile name",
  acceptanceCriteria: [{ id: "ac-1", text: "The new name persists after reload" }],
});

const validPlan = {
  version: 1,
  featureId: "profile-name",
  summary: "Verify persistence through the user interface",
  risks: [{ area: "profile", level: "medium", reason: "User data could be lost" }],
  scenarios: [
    {
      id: "persist-name",
      title: "Persist the edited name",
      criterionIds: ["ac-1"],
      technique: "happy_path",
      execution: "browser",
      priority: "p1",
      goal: "Edit and reload the profile",
      oracle: "The edited name remains visible after reload",
      evidence: ["ui", "network", "screenshot"],
      rationale: "Directly covers the acceptance criterion",
    },
  ],
  excluded: [{ area: "api", reason: "No API contract was provided" }],
};

describe("planFeature", () => {
  it("extracts and validates a fenced JSON plan", async () => {
    const model = new StaticModel([`Here is the plan:\n\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``]);

    const plan = await planFeature({ model, feature });

    expect(plan.featureId).toBe(feature.id);
    expect(plan.scenarios[0]?.criterionIds).toEqual(["ac-1"]);
    expect(model.calls).toBe(1);
  });

  it("asks once for a corrected plan when validation fails", async () => {
    const invalid = { ...validPlan, scenarios: [] };
    const model = new StaticModel([JSON.stringify(invalid), JSON.stringify(validPlan)]);

    const plan = await planFeature({ model, feature });

    expect(plan.scenarios).toHaveLength(1);
    expect(model.calls).toBe(2);
  });
});
