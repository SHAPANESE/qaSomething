import { describe, expect, it } from "vitest";
import { featureSchema, qaPlanSchema, validatePlanCoverage } from "./schema.js";

const featureInput = {
  version: 1,
  id: "checkout-coupon",
  goal: "Apply a coupon at checkout",
  acceptanceCriteria: [
    { id: "ac-1", text: "A valid coupon updates the total" },
    { id: "ac-2", text: "An expired coupon is rejected" },
  ],
};

describe("featureSchema", () => {
  it("applies risk-based coverage defaults", () => {
    const feature = featureSchema.parse(featureInput);

    expect(feature.coverage).toEqual({
      e2e: "auto",
      api: "auto",
      visual: "auto",
      security: "auto",
      matrix: [],
    });
    expect(feature.attempts).toBe(2);
  });
});

describe("validatePlanCoverage", () => {
  it("accepts a plan that maps every acceptance criterion", () => {
    const feature = featureSchema.parse(featureInput);
    const plan = qaPlanSchema.parse({
      version: 1,
      featureId: feature.id,
      summary: "Exercise valid and expired coupons",
      risks: [{ area: "pricing", level: "high", reason: "Incorrect totals affect money" }],
      scenarios: [
        {
          id: "valid-coupon",
          title: "Apply a valid coupon",
          criterionIds: ["ac-1"],
          technique: "happy_path",
          execution: "browser",
          priority: "p0",
          goal: "Apply a valid coupon",
          oracle: "The displayed total includes the discount",
          evidence: ["ui", "network", "screenshot"],
          rationale: "Core revenue path",
        },
        {
          id: "expired-coupon",
          title: "Reject an expired coupon",
          criterionIds: ["ac-2"],
          technique: "negative",
          execution: "browser",
          priority: "p1",
          goal: "Try an expired coupon",
          oracle: "The coupon is rejected and the total is unchanged",
          evidence: ["ui", "network"],
          rationale: "Negative business rule",
        },
      ],
      excluded: [{ area: "performance", reason: "No load-sensitive behavior in this feature" }],
    });

    expect(() => validatePlanCoverage(feature, plan)).not.toThrow();
  });

  it("rejects missing criteria and required API coverage without an API contract", () => {
    const feature = featureSchema.parse({
      ...featureInput,
      coverage: { api: "required" },
    });
    const plan = qaPlanSchema.parse({
      version: 1,
      featureId: feature.id,
      summary: "Incomplete",
      risks: [],
      scenarios: [
        {
          id: "valid-coupon",
          title: "Apply a valid coupon",
          criterionIds: ["ac-1"],
          technique: "happy_path",
          execution: "browser",
          priority: "p0",
          goal: "Apply a valid coupon",
          oracle: "The total changes",
          evidence: ["ui"],
          rationale: "Core path",
        },
      ],
      excluded: [],
    });

    expect(() => validatePlanCoverage(feature, plan)).toThrow(/ac-2.*API contract/);
  });

  it("routes a blocking ambiguity to manual review instead of guessing", () => {
    const feature = featureSchema.parse(featureInput);
    const plan = qaPlanSchema.parse({
      version: 1,
      featureId: feature.id,
      summary: "The expected expired-coupon message is ambiguous",
      risks: [],
      questions: [
        {
          id: "q-1",
          question: "Which error message is expected?",
          criterionIds: ["ac-2"],
          blocking: true,
          reason: "The criterion does not define an observable oracle",
        },
      ],
      scenarios: [
        {
          id: "all-coupons",
          title: "Exercise coupons",
          criterionIds: ["ac-1", "ac-2"],
          technique: "happy_path",
          execution: "browser",
          priority: "p1",
          goal: "Exercise valid and expired coupons",
          oracle: "The UI handles both coupons",
          evidence: ["ui"],
          rationale: "Cover both criteria",
        },
      ],
      excluded: [],
    });

    expect(() => validatePlanCoverage(feature, plan)).toThrow(/q-1.*manual_review/);
  });
});
