// The API client of a scene chat message (decisions/resources): send the
// DM's message, and retry a failed reply. The reply itself is written by the
// server; the chat is read again to see it (./scene-chat-query.ts).

import type { SceneChatMessage } from "@grimoire/shared/scene-chat-message";

import { campaignPath, postJson, sendJson } from "@/api";

function messagesUrl(campaign: string, chat: string, id?: string): string {
  const base = `${campaignPath(campaign)}/scene-chats/${encodeURIComponent(chat)}/messages`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** Send the DM's message; the answer is that message, the reply runs behind it. */
export function sendSceneChatMessage(
  campaign: string,
  chat: string,
  text: string,
): Promise<SceneChatMessage> {
  return postJson<SceneChatMessage>(messagesUrl(campaign, chat), { text });
}

/** Ask for a failed reply again, against the `rev` it was read with. */
export function retrySceneChatReply(
  campaign: string,
  chat: string,
  reply: Pick<SceneChatMessage, "id" | "rev">,
): Promise<SceneChatMessage> {
  return sendJson<SceneChatMessage>("PATCH", messagesUrl(campaign, chat, reply.id), {
    rev: reply.rev,
    status: "running",
  });
}
