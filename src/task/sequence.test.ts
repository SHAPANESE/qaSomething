import { describe, expect, it } from "vitest";
import { compileSequence, taskSequenceSchema } from "./sequence.js";

describe("taskSequenceSchema", () => {
  it("requires semantic actions and applies required=false", () => {
    const sequence = taskSequenceSchema.parse({
      version: 1,
      taskId: "login",
      title: "logs in",
      actions: [{ id: "navigate", intent: "Open login", code: 'await page.goto("/login")' }],
      assertion: { intent: "Dashboard opens", code: 'await expect(page).toHaveURL("/dashboard")' },
    });
    expect(sequence.actions[0]?.required).toBe(false);
  });
});

describe("compileSequence", () => {
  it("produces a readable Playwright test with action markers and a retained oracle", () => {
    const source = compileSequence({
      version: 1,
      taskId: "login",
      title: "logs in",
      actions: [
        {
          id: "navigate",
          intent: "Open login",
          code: 'await page.goto("/login")',
          required: true,
          risk: "read",
        },
        {
          id: "submit",
          intent: "Submit credentials",
          code: "await page.getByRole('button').click()",
          required: false,
          risk: "read",
        },
      ],
      assertion: { intent: "Dashboard opens", code: 'await expect(page).toHaveURL("/dashboard")' },
    });
    expect(source).toContain("action:navigate");
    expect(source).toContain("action:submit");
    expect(source).toContain("// oracle — Dashboard opens");
    expect(source).toContain("import { test, expect }");
    expect(source).toContain("__QA_EVIDENCE__");
    expect(source).toContain('testInfo.attach("qa-evidence"');
  });
});
