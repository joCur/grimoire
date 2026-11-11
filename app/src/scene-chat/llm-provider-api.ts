// Whether the instance has a language model to ask (`GET /api/llm-provider`).
// The chat reads it to say so before the DM writes anything.

import type { LlmProvider } from "@grimoire/shared/llm-provider";

import { getJson } from "@/api";

export function fetchLlmProvider(): Promise<LlmProvider> {
  return getJson<LlmProvider>("/llm-provider");
}
