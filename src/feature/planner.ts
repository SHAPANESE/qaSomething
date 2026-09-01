import type { Model } from "../model.js";
import type { Message } from "../types.js";
import { qaPlanSchema, validatePlanCoverage, type Feature, type QAPlan } from "./schema.js";

const SYSTEM_PROMPT = `You are a senior QA planner. Turn one product feature into a small, risk-based test campaign.

Return ONLY one JSON object. Do not use markdown unless the caller explicitly asks you to repair invalid JSON.

Rules:
- Map every acceptance criterion id to at least one scenario.
- Prioritize business impact and failure probability. Do not test every category by default.
- Select browser, API contract, visual, authorization/security, regression, boundary, negative, or manual review only when justified.
- browser means adaptive Playwright exploration. api_contract means the supplied OpenAPI/GraphQL contract runner. manual_review means automation would not produce a trustworthy oracle.
- Never label generic safety guardrails as security testing. Security scenarios must exercise an explicit authorization, validation, or data-exposure risk.
- Screenshots are evidence, not visual regression. Use technique visual only when visual behavior is part of the feature risk.
- Every scenario needs a precise oracle independent from the current application behavior.
- Record ambiguities as questions. If a question blocks a trustworthy oracle, route the affected criterion to a manual_review scenario instead of guessing.
- Keep the campaign focused: normally 2-6 scenarios, maximum 12.
- Respect coverage modes: required must be present, skip must be absent, auto is your risk-based decision.

Schema:
{"version":1,"featureId":"...","summary":"...","risks":[{"area":"...","level":"low|medium|high|critical","reason":"..."}],"questions":[{"id":"safe-id","question":"...","criterionIds":["ac-id"],"blocking":true,"reason":"..."}],"scenarios":[{"id":"safe-id","title":"...","criterionIds":["ac-id"],"technique":"happy_path|negative|boundary|authorization|security|regression|visual|api_contract|exploratory","execution":"browser|api_contract|manual_review","priority":"p0|p1|p2|p3","goal":"...","oracle":"...","evidence":["ui|network|console|screenshot"],"rationale":"..."}],"excluded":[{"area":"...","reason":"..."}]}`;

function extractJson(output: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(output)?.[1];
  const source = (fenced ?? output).trim();
  return JSON.parse(source) as unknown;
}

function featurePrompt(feature: Feature, reviewerFeedback?: string): string {
  return [
    "Create the risk-based QA plan for this feature:",
    JSON.stringify(feature, null, 2),
    reviewerFeedback === undefined ? "" : `Reviewer feedback to incorporate:\n${reviewerFeedback}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseAndValidate(feature: Feature, output: string): QAPlan {
  const plan = qaPlanSchema.parse(extractJson(output));
  validatePlanCoverage(feature, plan);
  return plan;
}

export async function planFeature(args: {
  model: Model;
  feature: Feature;
  reviewerFeedback?: string;
}): Promise<QAPlan> {
  const messages: Message[] = [
    {
      role: "user",
      content: featurePrompt(args.feature, args.reviewerFeedback),
    },
  ];
  const first = await args.model.generate(SYSTEM_PROMPT, messages);
  try {
    return parseAndValidate(args.feature, first);
  } catch (error) {
    messages.push({ role: "assistant", content: first });
    messages.push({
      role: "user",
      content: `The plan was rejected by the deterministic contract: ${String(error)}\nReturn one corrected JSON object.`,
    });
    const repaired = await args.model.generate(SYSTEM_PROMPT, messages);
    try {
      return parseAndValidate(args.feature, repaired);
    } catch (repairError) {
      throw new Error(`The model could not produce a valid QA plan: ${String(repairError)}`, {
        cause: repairError,
      });
    }
  }
}
