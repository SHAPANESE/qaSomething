import type { ParsedAction } from "./types.js";

interface FencedBlock {
  lang: string;
  body: string;
}

const FENCE_RE = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;

const COMMAND_LANGS = new Set(["bash", "sh", "shell", "console"]);
const FINISH_LANGS = new Set(["done", "finish"]);

function extractFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  for (const match of text.matchAll(FENCE_RE)) {
    blocks.push({
      lang: (match[1] ?? "").toLowerCase(),
      body: (match[2] ?? "").replace(/\r?\n$/, ""),
    });
  }
  return blocks;
}

/**
 * Extract the single action from an assistant turn.
 *
 * Protocol: the model reasons freely, then emits exactly one fenced block.
 * A ```done / ```finish block ends the mission (its body is the summary).
 * A ```bash / ```sh / ```shell block is a command to run.
 *
 * If both appear, `finish` wins (the agent is signalling completion).
 * If multiple command blocks appear, the last one is used and this is a soft
 * protocol smell the caller may choose to warn about — but we stay permissive
 * rather than failing the whole turn.
 */
export function parseAction(assistant: string): ParsedAction {
  const blocks = extractFencedBlocks(assistant);
  if (blocks.length === 0) {
    return {
      kind: "none",
      reason:
        "No fenced code block found. Emit exactly one ```bash command or a ```done summary.",
    };
  }

  const finish = blocks.filter((b) => FINISH_LANGS.has(b.lang)).at(-1);
  if (finish) {
    return { kind: "finish", summary: finish.body.trim() };
  }

  const command = blocks.filter((b) => COMMAND_LANGS.has(b.lang)).at(-1);
  if (command) {
    const trimmed = command.body.trim();
    if (trimmed.length === 0) {
      return { kind: "none", reason: "Empty command block." };
    }
    return { kind: "command", command: trimmed };
  }

  return {
    kind: "none",
    reason: `Found fenced block(s) but none were a command or finish block (languages: ${blocks
      .map((b) => b.lang || "<none>")
      .join(", ")}).`,
  };
}
