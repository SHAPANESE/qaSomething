import { describe, expect, it } from "vitest";
import { CLAUDE_CLI_ARGS } from "./model.js";

describe("CLAUDE_CLI_ARGS", () => {
  it("disables the inner CLI's tools and MCP servers", () => {
    expect(CLAUDE_CLI_ARGS).toEqual(expect.arrayContaining(["--strict-mcp-config"]));
    expect(CLAUDE_CLI_ARGS[CLAUDE_CLI_ARGS.indexOf("--tools") + 1]).toBe("");
  });
});
