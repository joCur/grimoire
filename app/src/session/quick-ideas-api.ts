// The API client of the quick-ideas chat of a running session: one question,
// answered at once. Nothing of the chat is stored (decisions/generator), so
// there is nothing to read back — the conversation lives in the live view.

import type { QuickIdeasQuestion, QuickIdeasReply } from "@grimoire/shared/quick-ideas";

import { postJson } from "@/api";

import { sessionsUrl } from "./session-api";

/**
 * Ask the model for a quick idea about the open scene, with the whole
 * conversation so far, the question last. An ended session takes none: 409
 * `session_ended`; a reply that cannot be used is the error of its reason.
 */
export function askQuickIdeas(
  campaign: string,
  sessionId: string,
  question: QuickIdeasQuestion,
): Promise<QuickIdeasReply> {
  return postJson<QuickIdeasReply>(`${sessionsUrl(campaign, sessionId)}/quick-ideas`, question);
}
