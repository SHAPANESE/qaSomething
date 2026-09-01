import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const taskId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores.");

export const oracleCheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url_matches"), pattern: z.string().min(1) }),
  z.object({ kind: z.literal("text_visible"), text: z.string().min(1), exact: z.boolean().default(true) }),
  z.object({ kind: z.literal("input_value"), selector: z.string().min(1), value: z.string() }),
  z.object({
    kind: z.literal("visual_snapshot"),
    name: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/),
    maxDiffPixels: z.number().int().min(0).default(0),
  }),
  z.object({
    kind: z.literal("network_request"),
    method: z.string().min(1),
    path: z.string().min(1),
    status: z.number().int().min(100).max(599),
  }),
  z.object({ kind: z.literal("no_page_errors") }),
]);

export const riskProfileSchema = z.object({
  impact: z.number().int().min(1).max(5),
  probability: z.number().int().min(1).max(5),
  areas: z.array(z.string().min(1)).min(1),
});

export const businessFlowSchema = z.enum([
  "authentication",
  "checkout",
  "authorization",
  "create",
  "read",
  "update",
  "delete",
  "error_handling",
  "regression",
  "custom",
]);

export const supervisionPolicySchema = z.object({
  mode: z.enum(["autonomous", "approve_risky", "approve_all"]).default("autonomous"),
  checkpointBeforeExecution: z.boolean().default(true),
  checkpointBeforeFinding: z.boolean().default(true),
  reviewer: z.string().min(1).optional(),
});

export const qaTaskSchema = z.object({
  version: z.literal(1),
  id: taskId,
  goal: z.string().min(1),
  spec: z.string().min(1).optional(),
  mutationSpec: z.string().min(1).optional(),
  target: z
    .object({
      baseUrl: z.string().url().optional(),
      actor: z.string().min(1).optional(),
      storageState: z.string().min(1).optional(),
    })
    .optional(),
  oracle: z.string().min(1).optional(),
  oracleChecks: z.array(oracleCheckSchema).min(1).optional(),
  risk: riskProfileSchema.optional(),
  business: z
    .object({
      flow: businessFlowSchema,
      capability: z.string().min(1),
      tags: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  execution: z
    .object({
      /** Names of Playwright projects configured by the target repository. */
      projects: z.array(z.string().min(1)).min(1),
    })
    .optional(),
  evidence: z
    .object({
      required: z.array(z.enum(["ui", "network", "console", "screenshot"])).min(1),
    })
    .optional(),
  safety: z
    .object({
      allow: z
        .array(
          z.enum([
            "read",
            "create_test_data",
            "modify_test_data",
            "delete_test_data",
            "external_message",
            "payment",
            "user_admin",
          ]),
        )
        .optional(),
      deny: z
        .array(
          z.enum([
            "read",
            "create_test_data",
            "modify_test_data",
            "delete_test_data",
            "external_message",
            "payment",
            "user_admin",
          ]),
        )
        .optional(),
      /** Caps browser requests for a task, protecting staging from accidental load. */
      maxRequests: z.number().int().positive().optional(),
    })
    .optional(),
  supervision: supervisionPolicySchema.optional(),
  attempts: z.number().int().min(1).max(10).default(2),
  blockedReason: z.string().min(1).optional(),
});

export type QATask = z.infer<typeof qaTaskSchema>;
export type OracleCheck = z.infer<typeof oracleCheckSchema>;

export async function loadTask(taskFile: string): Promise<QATask> {
  const source = await readFile(taskFile, "utf8");
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    throw new Error(`Task file is not valid JSON: ${taskFile}`);
  }
  return qaTaskSchema.parse(input);
}

export function resolveTaskSpec(repoPath: string, spec: string): string {
  const repo = path.resolve(repoPath);
  const resolved = path.resolve(repo, spec);
  const relative = path.relative(repo, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Task spec must stay inside the repository: ${spec}`);
  }
  if (!resolved.endsWith(".spec.ts")) {
    throw new Error(`Task spec must be a Playwright *.spec.ts file: ${spec}`);
  }
  return resolved;
}
