import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Per-repo configuration, `qa-agent.config.json` at the repo root. Validated so a
 * typo or wrong type fails loudly with a clear message instead of silently doing
 * the wrong thing. CLI flags override these; these override the built-in defaults.
 */
export const ProjectConfigSchema = z
  .object({
    allowedWriteDirs: z.array(z.string()).min(1).optional(),
    reruns: z.number().int().positive().optional(),
    commandTimeoutMs: z.number().int().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
    model: z.string().min(1).optional(),
    /** How to start the app locally — surfaced to the agent so it doesn't guess. */
    startCommand: z.string().min(1).optional(),
    /** Base URL the app serves on. */
    baseUrl: z.string().min(1).optional(),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const CONFIG_FILENAME = "qa-agent.config.json";

/** Pure: parse + validate raw JSON. Throws a readable error on invalid config. */
export function parseProjectConfig(raw: string): ProjectConfig {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${CONFIG_FILENAME} is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  const result = ProjectConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${CONFIG_FILENAME} is invalid:\n${issues}`);
  }
  return result.data;
}

/** Load and validate the repo's config file, or null if there isn't one. */
export async function loadProjectConfig(repoPath: string): Promise<ProjectConfig | null> {
  const file = path.join(repoPath, CONFIG_FILENAME);
  if (!existsSync(file)) return null;
  return parseProjectConfig(await readFile(file, "utf8"));
}
