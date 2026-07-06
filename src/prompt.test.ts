import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";
import { buildMissionPrompt, buildSystemPrompt } from "./prompt.js";

const config = resolveConfig("/repo");
const CRITERIA = "SENIOR-QA-CRITERIA-MARKER";

describe("buildSystemPrompt — the agent's contract", () => {
  const system = buildSystemPrompt(CRITERIA, config);

  it("embeds the criteria manual (the brain)", () => {
    expect(system).toContain(CRITERIA);
  });

  it("states the app-source-read-only guardrail", () => {
    expect(system).toMatch(/read-only/i);
    expect(system).toMatch(/tests\//);
  });

  it("requires a mutation proof per test", () => {
    expect(system).toMatch(/mutation\.spec\.ts/);
    expect(system).toMatch(/must fail|goes? red|REJECTED/i);
  });

  it("mandates semantic locators and forbids sleeps", () => {
    expect(system).toMatch(/getByRole|getByLabel|data-testid/);
    expect(system).toMatch(/no.*xpath|no arbitrary `?sleep/i);
  });

  it("forbids editing the app to make a test pass", () => {
    expect(system).toMatch(/do not.*fix the app|report it/i);
  });

  it("does not include repair guidance by default", () => {
    expect(system).not.toMatch(/Mission mode: REPAIR/i);
  });

  it("adds repair guidance in repair mode", () => {
    const repair = buildSystemPrompt(CRITERIA, config, true);
    expect(repair).toMatch(/Mission mode: REPAIR/i);
    expect(repair).toMatch(/NEVER.*weaken.*assertion/i);
  });
});

describe("buildMissionPrompt", () => {
  it("includes the mission and repo", () => {
    const p = buildMissionPrompt("Test login", config);
    expect(p).toContain("Test login");
    expect(p).toContain("/repo");
  });

  it("injects the oracle when provided", () => {
    const p = buildMissionPrompt("m", config, "ORACLE-BLOCK");
    expect(p).toContain("ORACLE-BLOCK");
  });

  it("surfaces the environment (start command / base URL)", () => {
    const p = buildMissionPrompt("m", config, undefined, {
      startCommand: "npm run dev",
      baseUrl: "http://localhost:3000",
    });
    expect(p).toContain("npm run dev");
    expect(p).toContain("http://localhost:3000");
  });
});
