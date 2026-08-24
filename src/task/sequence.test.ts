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
    expect(sequence.mutation).toBeUndefined();
    expect(sequence.cleanup).toEqual([]);
  });

  it("compiles a mutation setup before the normal semantic actions", () => {
    const source = compileSequence(
      {
        version: 1,
        taskId: "login",
        title: "logs in",
        actions: [
          {
            id: "navigate",
            intent: "Open login",
            code: 'await page.goto("/")',
            required: true,
            risk: "read",
          },
        ],
        assertion: { intent: "Dashboard opens", code: "await expect(page).toHaveURL(/dashboard/)" },
        mutation: {
          intent: "Reject login API",
          code: 'await page.route("**/api/login", route => route.fulfill({ status: 500 }))',
          risk: "read",
        },
      },
      {},
      true,
    );
    expect(source).toContain("mutation â€” Reject login API");
    expect(source.indexOf("mutation â€” Reject login API")).toBeLessThan(source.indexOf("action:navigate"));
    expect(source).toContain("logs in [mutation]");
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

  it("runs cleanup after evidence capture and makes cleanup failure visible", () => {
    const source = compileSequence({
      version: 1,
      taskId: "login",
      title: "logs in",
      actions: [
        { id: "navigate", intent: "Open", code: 'await page.goto("/")', required: true, risk: "read" },
      ],
      assertion: { intent: "Page opens", code: "await expect(page).toHaveURL(/./)" },
      cleanup: [
        {
          id: "delete",
          intent: "Remove test data",
          code: "await cleanupTestData()",
          required: true,
          risk: "delete_test_data",
        },
      ],
    });
    expect(source).toContain("cleanup:delete");
    expect(source).toContain("cleanupErrors");
    expect(source.indexOf("qa-final-page")).toBeLessThan(source.indexOf("cleanup:delete"));
  });

  it("adds structured oracle checks to the generated spec", () => {
    const source = compileSequence(
      {
        version: 1,
        taskId: "login",
        title: "logs in",
        actions: [
          { id: "navigate", intent: "Open", code: 'await page.goto("/")', required: true, risk: "read" },
        ],
        assertion: { intent: "Page opens", code: "await expect(page).toHaveURL(/./)" },
      },
      {
        oracleChecks: [{ kind: "text_visible", text: "Dashboard", exact: true }, { kind: "no_page_errors" }],
      },
    );
    expect(source).toContain('page.getByText("Dashboard", { exact: true })');
    expect(source).toContain("expect(qaEvidence.pageErrors).toEqual([])");
  });

  it("compiles an input-value oracle as a Playwright assertion", () => {
    const source = compileSequence(
      {
        version: 1,
        taskId: "todo",
        title: "creates a todo",
        actions: [{ id: "open", intent: "Open", code: 'await page.goto("/")', required: true, risk: "read" }],
        assertion: { intent: "Todo is created", code: "await expect(page).toHaveURL(/./)" },
      },
      { oracleChecks: [{ kind: "input_value", selector: 'input[value="QA todo"]', value: "QA todo" }] },
    );
    expect(source).toContain('page.locator("input[value=\\"QA todo\\"]")');
    expect(source).toContain('toHaveValue("QA todo")');
  });

  it("compiles visual and request-budget checks", () => {
    const source = compileSequence(
      {
        version: 1,
        taskId: "dashboard",
        title: "renders dashboard",
        actions: [{ id: "open", intent: "Open", code: 'await page.goto("/")', required: true, risk: "read" }],
        assertion: { intent: "Dashboard opens", code: "await expect(page).toHaveURL(/./)" },
      },
      {
        oracleChecks: [{ kind: "visual_snapshot", name: "dashboard.png", maxDiffPixels: 12 }],
        maxRequests: 30,
      },
    );
    expect(source).toContain('toHaveScreenshot("dashboard.png", { maxDiffPixels: 12 })');
    expect(source).toContain("qaEvidence.requestCount++");
    expect(source).toContain("toBeLessThanOrEqual(30)");
  });
});
