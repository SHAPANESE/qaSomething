import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage } from "ai";
import { execa } from "execa";
import type { Message } from "./types.js";

/**
 * Thin, provider-agnostic model boundary. The loop only knows about this
 * interface, so swapping Claude for another backend is a one-file change —
 * the "model-agnostic" promise from the spec, kept honest.
 */
export interface Model {
  readonly id: string;
  generate(system: string, messages: Message[]): Promise<string>;
}

/**
 * Subscription-backed model: shells out to the local Claude Code CLI (`claude -p`)
 * instead of the Anthropic API, so it needs NO ANTHROPIC_API_KEY — it uses the
 * user's Claude Code subscription. `claude -p` is stateless, so we pass the whole
 * conversation each turn and constrain it to emit only the next action.
 */
export function claudeCliModel(): Model {
  return {
    id: "claude-cli (subscription)",
    async generate(system, messages) {
      const convo = messages
        .filter((m) => m.role !== "system")
        .map((m) => `### ${m.role.toUpperCase()}\n${m.content}`)
        .join("\n\n");
      const prompt = [
        "You are a text generator inside another program. Read the INSTRUCTIONS and the CONVERSATION,",
        "then output ONLY the next single action — one ```bash block OR one ```done block — and nothing",
        "else. Never use tools; never execute anything yourself; just print the block.",
        "\n===== INSTRUCTIONS =====\n" + system,
        "\n===== CONVERSATION =====\n" + convo,
        "\n===== YOUR TURN (one action only) =====",
      ].join("\n");
      const res = await execa("claude", ["-p", "--output-format", "text"], {
        input: prompt,
        reject: false,
        timeout: 300_000,
      });
      return String(res.stdout ?? "");
    },
  };
}

export function createAnthropicModel(modelId: string): Model {
  const model = anthropic(modelId);
  return {
    id: modelId,
    async generate(system, messages) {
      const history: ModelMessage[] = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const { text } = await generateText({ model, system, messages: history });
      return text;
    },
  };
}
