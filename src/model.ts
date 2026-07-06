import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage } from "ai";
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
