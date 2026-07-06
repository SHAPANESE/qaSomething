import { describe, expect, it } from "vitest";
import { parseAction } from "./parse.js";

describe("parseAction", () => {
  it("extracts a bash command", () => {
    const action = parseAction("Let me look around.\n```bash\nls -la\n```");
    expect(action).toEqual({ kind: "command", command: "ls -la" });
  });

  it("accepts sh/shell/console fences", () => {
    for (const lang of ["sh", "shell", "console"]) {
      const action = parseAction(`\`\`\`${lang}\necho hi\n\`\`\``);
      expect(action).toEqual({ kind: "command", command: "echo hi" });
    }
  });

  it("uses the last command block when several are present", () => {
    const action = parseAction("```bash\nfirst\n```\nthen\n```bash\nsecond\n```");
    expect(action).toEqual({ kind: "command", command: "second" });
  });

  it("parses a finish block and returns its summary", () => {
    const action = parseAction(
      "All done.\n```done\nWrote login.spec.ts; it catches the empty-email bug.\n```",
    );
    expect(action).toEqual({
      kind: "finish",
      summary: "Wrote login.spec.ts; it catches the empty-email bug.",
    });
  });

  it("prefers finish over a command when both are present", () => {
    const action = parseAction("```bash\nls\n```\n```finish\ndone here\n```");
    expect(action).toEqual({ kind: "finish", summary: "done here" });
  });

  it("preserves multi-line commands verbatim", () => {
    const cmd = "cat > probe.mjs <<'EOF'\nimport { chromium } from 'playwright';\nEOF";
    const action = parseAction("```bash\n" + cmd + "\n```");
    expect(action).toEqual({ kind: "command", command: cmd });
  });

  it("returns none when there is no fenced block", () => {
    const action = parseAction("I think I should list files first.");
    expect(action.kind).toBe("none");
  });

  it("returns none for an empty command block", () => {
    const action = parseAction("```bash\n\n```");
    expect(action.kind).toBe("none");
  });

  it("returns none when the only fence is an unrelated language", () => {
    const action = parseAction('```json\n{"a":1}\n```');
    expect(action.kind).toBe("none");
  });
});
