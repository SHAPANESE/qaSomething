import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const taskId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores.");

export const qaTaskSchema = z.object({
  version: z.literal(1),
  id: taskId,
  goal: z.string().min(1),
  spec: z.string().min(1).optional(),
  target: z
    .object({
      baseUrl: z.string().url().optional(),
      actor: z.string().min(1).optional(),
      storageState: z.string().min(1).optional(),
    })
    .optional(),
  oracle: z.string().min(1).optional(),
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
    })
    .optional(),
  attempts: z.number().int().min(1).max(10).default(2),
  blockedReason: z.string().min(1).optional(),
});

export type QATask = z.infer<typeof qaTaskSchema>;

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
