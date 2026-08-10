import { readFile } from "node:fs/promises";
import { z } from "zod";

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

export const taskSequenceSchema = z.object({
  version: z.literal(1),
  taskId: z.string().min(1),
  title: z.string().min(1),
  actions: z.array(semanticActionSchema).min(1),
  assertion: z.object({
    intent: z.string().min(1),
    code: codeBlock,
  }),
});

export type SemanticAction = z.infer<typeof semanticActionSchema>;
export type TaskSequence = z.infer<typeof taskSequenceSchema>;

export async function loadTaskSequence(file: string): Promise<TaskSequence> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Sequence file is not valid JSON: ${file}`);
  }
  const sequence = taskSequenceSchema.parse(input);
  const ids = sequence.actions.map((action) => action.id);
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
  options: { baseUrl?: string; storageState?: string } = {},
): string {
  const actions = sequence.actions
    .map((action) => `  // action:${action.id} — ${action.intent}\n${indent(action.code)}`)
    .join("\n\n");
  const useOptions = {
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
  };
  const useLine = Object.keys(useOptions).length > 0 ? `\ntest.use(${JSON.stringify(useOptions)});\n` : "";
  return `import { test, expect } from "@playwright/test";
${useLine}

test(${JSON.stringify(sequence.title)}, async ({ page }, testInfo) => {
  const qaEvidence = {
    channels: ["ui", "network", "console"] as Array<"ui" | "network" | "console" | "screenshot">,
    oracleReached: false,
    responses: [] as Array<{ method: string; url: string; status: number }>,
    console: [] as Array<{ type: string; text: string }>,
    pageErrors: [] as string[],
    finalUrl: undefined as string | undefined,
    pageTitle: undefined as string | undefined,
  };
  page.on("response", response => qaEvidence.responses.push({
    method: response.request().method(), url: response.url(), status: response.status()
  }));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) qaEvidence.console.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", error => qaEvidence.pageErrors.push(error.message));
  try {
${actions}

    // oracle — ${sequence.assertion.intent}
    qaEvidence.oracleReached = true;
${indent(sequence.assertion.code)}
  } finally {
    qaEvidence.finalUrl = page.url();
    qaEvidence.pageTitle = await page.title().catch(() => undefined);
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined);
    if (screenshot !== undefined) {
      qaEvidence.channels.push("screenshot");
      await testInfo.attach("qa-final-page", { body: screenshot, contentType: "image/png" });
    }
    console.log("__QA_EVIDENCE__" + JSON.stringify(qaEvidence));
    await testInfo.attach("qa-evidence", { body: JSON.stringify(qaEvidence, null, 2), contentType: "application/json" });
  }
});
`;
}
