// The LLM PROVIDER of the instance as `GET /api/llm-provider` answers it:
// whether a provider is configured, so a view that would ask the model
// can say so before the DM writes anything (decisions/generator).

import { z } from "zod";

/**
 * `configured` is whether the server could reach a model with what its
 * environment holds. The provider's name, model and keys stay on the server.
 */
export const llmProviderSchema = z.strictObject({
  configured: z.boolean(),
});

export type LlmProvider = z.infer<typeof llmProviderSchema>;
