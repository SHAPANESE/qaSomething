import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { OracleCheck } from "./schema.js";

const codeBlock = z
  .string()
  .min(1)
  .refine((value) => !value.includes("```"), "Code must not contain fences.");

export const semanticActionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  intent: z.string().min(1),
  code: codeBlock,
  required: z.boolean().default(false),
  risk: z
    .enum([
      "read",
      "create_test_data",
      "modify_test_data",
      "delete_test_data",
      "external_message",
      "payment",
      "user_admin",
    ])
    .default("read"),
});

export const mutationSchema = z.object({
  intent: z.string().min(1),
  /** Runs before the semantic actions only in the generated mutation spec. */
  code: codeBlock,
  risk: semanticActionSchema.shape.risk,
});

export const taskSequenceSchema = z.object({
  version: z.literal(1),
  taskId: z.string().min(1),
  title: z.string().min(1),
  actions: z.array(semanticActionSchema).min(1),
  assertion: z.object({
    intent: z.string().min(1),
    code: codeBlock,
  }),
  /** Best-effort teardown after evidence capture, even when the oracle fails. */
  cleanup: z.array(semanticActionSchema).default([]),
  // Optional for backwards-compatible manual `task compile`; `task explore`
  // requires it before accepting a passing generated test.
  mutation: mutationSchema.optional(),
});

export type SemanticAction = z.infer<typeof semanticActionSchema>;
export type TaskMutation = z.infer<typeof mutationSchema>;
export type TaskSequence = z.infer<typeof taskSequenceSchema>;

export async function loadTaskSequence(file: string): Promise<TaskSequence> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Sequence file is not valid JSON: ${file}`);
  }
  const sequence = taskSequenceSchema.parse(input);
  const ids = [...sequence.actions, ...sequence.cleanup].map((action) => action.id);
  if (new Set(ids).size !== ids.length) throw new Error(`Sequence action ids must be unique: ${file}`);
  return sequence;
}

function indent(code: string): string {
  return code
    .trim()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/** Compile the semantic sequence into the only Playwright artifact that is verified. */
export function compileSequence(
  sequence: TaskSequence,
  options: {
    baseUrl?: string;
    storageState?: string;
    oracleChecks?: OracleCheck[];
    maxRequests?: number;
  } = {},
  mutation = false,
): string {
  const actions = sequence.actions
    .map((action) => `  // action:${action.id} — ${action.intent}\n${indent(action.code)}`)
    .join("\n\n");
  const cleanup = (sequence.cleanup ?? [])
    .map((action) => `    // cleanup:${action.id} â€” ${action.intent}\n${indent(action.code)}`)
    .join("\n\n");
  const useOptions = {
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
  };
  const useLine = Object.keys(useOptions).length > 0 ? `\ntest.use(${JSON.stringify(useOptions)});\n` : "";
  if (mutation && sequence.mutation === undefined) {
    throw new Error("A mutation spec requires sequence.mutation.");
  }
  const mutationSetup = mutation
    ? `\n    // mutation â€” ${sequence.mutation!.intent}\n${indent(sequence.mutation!.code)}\n`
    : "";
  const title = mutation ? `${sequence.title} [mutation]` : sequence.title;
  const structuredChecks = (options.oracleChecks ?? [])
    .map((check) => {
      if (check.kind === "url_matches")
        return `    await expect(page).toHaveURL(new RegExp(${JSON.stringify(check.pattern)}));`;
      if (check.kind === "text_visible")
        return `    await expect(page.getByText(${JSON.stringify(check.text)}, { exact: ${check.exact} })).toBeVisible();`;
      if (check.kind === "input_value")
        return `    await expect(page.locator(${JSON.stringify(check.selector)})).toHaveValue(${JSON.stringify(check.value)});`;
      if (check.kind === "visual_snapshot")
        return `    await expect(page).toHaveScreenshot(${JSON.stringify(check.name)}, { maxDiffPixels: ${check.maxDiffPixels} });`;
      if (check.kind === "network_request")
        return `    expect(qaEvidence.responses.some(response => response.method === ${JSON.stringify(check.method)} && new URL(response.url).pathname === ${JSON.stringify(check.path)} && response.status === ${check.status})).toBe(true);`;
      return "    expect(qaEvidence.pageErrors).toEqual([]);";
    })
    .join("\n");
  return `import { test, expect } from "@playwright/test";
${useLine}

test(${JSON.stringify(title)}, async ({ page }, testInfo) => {
  const qaEvidence = {
    channels: ["ui", "network", "console"] as Array<"ui" | "network" | "console" | "screenshot">,
    oracleReached: false,
    responses: [] as Array<{ method: string; url: string; status: number }>,
    console: [] as Array<{ type: string; text: string }>,
    pageErrors: [] as string[],
    cleanupErrors: [] as string[],
    requestCount: 0,
    finalUrl: undefined as string | undefined,
    pageTitle: undefined as string | undefined,
  };
  page.on("response", response => qaEvidence.responses.push({
    method: response.request().method(), url: response.url(), status: response.status()
  }));
  page.on("request", () => qaEvidence.requestCount++);
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) qaEvidence.console.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", error => qaEvidence.pageErrors.push(error.message));
  let oraclePassed = false;
  try {
${mutationSetup}
${actions}

    // oracle — ${sequence.assertion.intent}
    qaEvidence.oracleReached = true;
${indent(sequence.assertion.code)}
${structuredChecks}
${options.maxRequests === undefined ? "" : `    expect(qaEvidence.requestCount).toBeLessThanOrEqual(${options.maxRequests});\n`}
    oraclePassed = true;
  } finally {
    qaEvidence.finalUrl = page.url();
    qaEvidence.pageTitle = await page.title().catch(() => undefined);
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined);
    if (screenshot !== undefined) {
      qaEvidence.channels.push("screenshot");
      await testInfo.attach("qa-final-page", { body: screenshot, contentType: "image/png" });
    }
    let cleanupError: unknown;
    try {
${cleanup || "      // No cleanup actions declared."}
    } catch (error) {
      cleanupError = error;
      qaEvidence.cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    console.log("__QA_EVIDENCE__" + JSON.stringify(qaEvidence));
    await testInfo.attach("qa-evidence", { body: JSON.stringify(qaEvidence, null, 2), contentType: "application/json" });
    if (cleanupError !== undefined && oraclePassed) throw cleanupError;
  }
});
`;
}
