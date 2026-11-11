// The LLM provider of the instance: whether one is configured.

import { Hono } from "hono";
import type { LlmProvider } from "@grimoire/shared/llm-provider";
import { chatProviderConfigured } from "../scene-chat-reply";

export const llmProviderRoutes = new Hono();

// GET /api/llm-provider -> LlmProvider
// `{ configured }`: whether the server's environment names a provider it can
// reach a model with. Campaign-independent, like the settings: the provider
// belongs to the INSTANCE. A view that would ask the model reads it to say
// so before the DM writes anything; name, model and keys stay on the server.
llmProviderRoutes.get("/llm-provider", (c) =>
  c.json({ configured: chatProviderConfigured() } satisfies LlmProvider),
);
