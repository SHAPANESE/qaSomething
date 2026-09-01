import { readFile } from "node:fs/promises";
import { z } from "zod";
import { oracleCheckSchema, qaTaskSchema, supervisionPolicySchema } from "../task/schema.js";

const safeId = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores.");

export const coverageModeSchema = z.enum(["auto", "required", "skip"]);

export const featureCoverageSchema = z.object({
  e2e: coverageModeSchema.default("auto"),
  api: coverageModeSchema.default("auto"),
  visual: coverageModeSchema.default("auto"),
  security: coverageModeSchema.default("auto"),
  matrix: z.array(z.string().min(1)).default([]),
});

export const acceptanceCriterionSchema = z.object({
  id: safeId,
  text: z.string().min(1),
  oracleChecks: z.array(oracleCheckSchema).min(1).optional(),
});

export const featureSchema = z
  .object({
    version: z.literal(1),
    id: safeId,
    goal: z.string().min(1),
    context: z.string().min(1).optional(),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
    target: qaTaskSchema.shape.target,
    risk: qaTaskSchema.shape.risk,
    safety: qaTaskSchema.shape.safety,
    attempts: qaTaskSchema.shape.attempts,
    coverage: featureCoverageSchema.default({
      e2e: "auto",
      api: "auto",
      visual: "auto",
      security: "auto",
      matrix: [],
    }),
    api: z
      .object({
        spec: z.string().min(1),
        url: z.string().url().optional(),
        checks: z.array(z.string().min(1)).min(1).optional(),
        mode: z.enum(["positive", "negative", "all"]).default("all"),
        maxExamples: z.number().int().positive().optional(),
      })
      .optional(),
    supervision: supervisionPolicySchema.optional(),
  })
  .superRefine((feature, context) => {
    const ids = new Set<string>();
    for (const [index, criterion] of feature.acceptanceCriteria.entries()) {
      if (ids.has(criterion.id)) {
        context.addIssue({
          code: "custom",
          path: ["acceptanceCriteria", index, "id"],
          message: `Duplicate acceptance criterion id: ${criterion.id}.`,
        });
      }
      ids.add(criterion.id);
    }
  });

export const scenarioTechniqueSchema = z.enum([
  "happy_path",
  "negative",
  "boundary",
  "authorization",
  "security",
  "regression",
  "visual",
  "api_contract",
  "exploratory",
]);

export const qaScenarioSchema = z.object({
  id: safeId,
  title: z.string().min(1),
  criterionIds: z.array(safeId).min(1),
  technique: scenarioTechniqueSchema,
  execution: z.enum(["browser", "api_contract", "manual_review"]),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  goal: z.string().min(1),
  oracle: z.string().min(1),
  evidence: z.array(z.enum(["ui", "network", "console", "screenshot"])).default([]),
  rationale: z.string().min(1),
});

export const qaPlanSchema = z.object({
  version: z.literal(1),
  featureId: safeId,
  summary: z.string().min(1),
  risks: z.array(
    z.object({
      area: z.string().min(1),
      level: z.enum(["low", "medium", "high", "critical"]),
      reason: z.string().min(1),
    }),
  ),
  questions: z
    .array(
      z.object({
        id: safeId,
        question: z.string().min(1),
        criterionIds: z.array(safeId).min(1),
        blocking: z.boolean(),
        reason: z.string().min(1),
      }),
    )
    .default([]),
  scenarios: z.array(qaScenarioSchema).min(1).max(12),
  excluded: z.array(z.object({ area: z.string().min(1), reason: z.string().min(1) })),
});

export type Feature = z.infer<typeof featureSchema>;
export type QAPlan = z.infer<typeof qaPlanSchema>;
export type QAScenario = z.infer<typeof qaScenarioSchema>;

export function validatePlanCoverage(feature: Feature, plan: QAPlan): void {
  const errors: string[] = [];
  if (plan.featureId !== feature.id) errors.push(`Plan featureId must be ${feature.id}.`);

  const criteria = new Set(feature.acceptanceCriteria.map((criterion) => criterion.id));
  const covered = new Set<string>();
  const scenarioIds = new Set<string>();
  for (const scenario of plan.scenarios) {
    if (scenarioIds.has(scenario.id)) errors.push(`Duplicate scenario id: ${scenario.id}.`);
    scenarioIds.add(scenario.id);
    for (const criterionId of scenario.criterionIds) {
      if (!criteria.has(criterionId)) errors.push(`Unknown acceptance criterion: ${criterionId}.`);
      else covered.add(criterionId);
    }
    if (scenario.execution === "browser" && scenario.evidence.length === 0) {
      errors.push(`Browser scenario ${scenario.id} must request runtime evidence.`);
    }
    if (scenario.execution === "api_contract" && scenario.technique !== "api_contract") {
      errors.push(`API execution scenario ${scenario.id} must use the api_contract technique.`);
    }
  }
  for (const question of plan.questions) {
    for (const criterionId of question.criterionIds) {
      if (!criteria.has(criterionId))
        errors.push(`Question ${question.id} references unknown criterion ${criterionId}.`);
    }
    if (question.blocking) {
      const routedToReview = plan.scenarios.some(
        (scenario) =>
          scenario.execution === "manual_review" &&
          question.criterionIds.some((criterionId) => scenario.criterionIds.includes(criterionId)),
      );
      if (!routedToReview) {
        errors.push(`Blocking question ${question.id} must route its affected criterion to manual_review.`);
      }
    }
  }

  const missing = [...criteria].filter((criterionId) => !covered.has(criterionId));
  if (missing.length > 0) errors.push(`Acceptance criteria missing from the plan: ${missing.join(", ")}.`);

  const hasBrowser = plan.scenarios.some((scenario) => scenario.execution === "browser");
  const hasApi = plan.scenarios.some((scenario) => scenario.execution === "api_contract");
  const hasVisual = plan.scenarios.some((scenario) => scenario.technique === "visual");
  const hasSecurity = plan.scenarios.some(
    (scenario) => scenario.technique === "authorization" || scenario.technique === "security",
  );

  if (hasApi && feature.api === undefined)
    errors.push("API contract scenario requires feature.api configuration.");
  if (feature.coverage.e2e === "required" && !hasBrowser) errors.push("Required E2E coverage is missing.");
  if (feature.coverage.api === "required") {
    if (feature.api === undefined)
      errors.push("API contract coverage is required but feature.api is missing.");
    if (!hasApi) errors.push("Required API contract scenario is missing.");
  }
  if (feature.coverage.visual === "required" && !hasVisual)
    errors.push("Required visual coverage is missing.");
  if (feature.coverage.security === "required" && !hasSecurity) {
    errors.push("Required authorization/security coverage is missing.");
  }
  if (feature.coverage.e2e === "skip" && hasBrowser) errors.push("E2E coverage is marked skip.");
  if (feature.coverage.api === "skip" && hasApi) errors.push("API coverage is marked skip.");
  if (feature.coverage.visual === "skip" && hasVisual) errors.push("Visual coverage is marked skip.");
  if (feature.coverage.security === "skip" && hasSecurity) errors.push("Security coverage is marked skip.");

  if (errors.length > 0) throw new Error(errors.join(" "));
}

export async function loadFeature(file: string): Promise<Feature> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Feature file is not valid JSON: ${file}`, { cause: error });
  }
  return featureSchema.parse(input);
}
