import { z } from "zod";

/**
 * The flaky/failure registry (`.qa-agent/flaky.json`): what qa-triage learned
 * about specs that don't cleanly pass — flaky, drifted locators, or a real
 * behavior regression. One entry per spec (latest wins).
 */

export const FLAKY_CLASSES = ["flaky", "locator-drift", "behavior-regression", "unknown"] as const;
export type FlakyClass = (typeof FLAKY_CLASSES)[number];

export const FlakyEntrySchema = z
  .object({
    spec: z.string().min(1),
    caseId: z.string().optional(),
    class: z.enum(FLAKY_CLASSES),
    note: z.string(),
    updated: z.string().min(1),
  })
  .strict();
export type FlakyEntry = z.infer<typeof FlakyEntrySchema>;

export const FlakyRegistrySchema = z
  .object({
    version: z.literal(1),
    entries: z.array(FlakyEntrySchema),
  })
  .strict();
export type FlakyRegistry = z.infer<typeof FlakyRegistrySchema>;

export function emptyFlaky(): FlakyRegistry {
  return { version: 1, entries: [] };
}

export function parseFlaky(raw: string): FlakyRegistry {
  return FlakyRegistrySchema.parse(JSON.parse(raw));
}

export function serializeFlaky(reg: FlakyRegistry): string {
  return JSON.stringify(reg, null, 2) + "\n";
}

/** Insert or replace the entry for a spec (latest wins), returning a new registry. */
export function upsertFlaky(reg: FlakyRegistry, entry: FlakyEntry): FlakyRegistry {
  const entries = reg.entries.filter((e) => e.spec !== entry.spec);
  entries.push(entry);
  return { ...reg, entries };
}
