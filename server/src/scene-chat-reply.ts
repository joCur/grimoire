// The reply of a scene chat (decisions/generator): written on the server,
// in the background, from the context as it is stored at that moment.
//
// Sending a message answers at once (routes/scene-chat-messages.ts) with the
// DM's message; the reply stands in the chat as `running`, and the app polls
// the chat until it is `done` or `failed`. Nothing depends on an open tab.
// A reply is not a generator job: it is no row of `generate_jobs`, counts
// against no limit of the campaign's job and waits for none.
//
// Every reply sends the whole conversation, because the model APIs keep no
// state: the system prompt (generator/scene-chat-system-prompt.md plus the
// language of the DM), the CONTEXT block as the first user turn — the
// campaign knowledge, the glossary, the chapter's text, the scene with every
// field and its text, the npcs its `npcs` names and the location its
// `location` names, each with every field and its text — and then the
// written messages of the chat so far. The context comes first and stays the
// same from reply to reply until the DM edits what it shows, so the providers
// cache it (llm-provider.ts `chatTurns`).
//
// The reply is free Markdown and is never written into a row of the
// campaign: it carries no schema and is not validated. A reply that cannot be
// written — a provider error, a timeout, a reply cut off at the output cap, a
// restart (db/scene-chat-boot.ts) — fails with its reason as an error body
// the app says in a sentence, and the DM retries it.

import type { SceneChatRole } from "@grimoire/shared/scene-chat-message";
import {
  askChat,
  chatFailure,
  chatSystemPrompt,
  contextBlock,
  sceneContextSections,
  type ChatOutcome,
} from "./chat-reply";
import { ASSET_FILES } from "./generator";
import type { ChatProvider, ChatRequest, ChatTurn } from "./llm-provider";
// The reply reads the chat and writes itself through the store; its context
// is read in ./chat-reply.ts.
import { getDb } from "./store/handle";
import { finishSceneChatReply, sceneChatReplyInput } from "./store/scene-chat-messages";

/** How long a reply may take before it fails as timed out. */
export const SCENE_CHAT_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

/** A stored role in the role both APIs speak. */
function turnRole(role: SceneChatRole): ChatTurn["role"] {
  return role === "dm" ? "user" : "assistant";
}

// --- the reply -----------------------------------------------------------------

/**
 * Write the running reply `replyId` of a chat: read its context and the
 * turns before it, ask the provider, and store the text or the reason it
 * failed. Never throws — every failure ends up on the reply. A reply that is
 * no longer running (or no longer there) when it starts is left alone.
 */
export async function writeSceneChatReply(
  campaign: string,
  chatId: string,
  replyId: string,
  provider: ChatProvider,
): Promise<void> {
  let outcome: ChatOutcome;
  try {
    const input = sceneChatReplyInput(await getDb(), campaign, chatId, replyId);
    if (input === undefined) return;
    const request: ChatRequest = {
      systemPrompt: await chatSystemPrompt(ASSET_FILES.sceneChat.systemPrompt),
      context: contextBlock(await sceneContextSections(campaign, input.scene)),
      turns: input.turns.map((turn) => ({ role: turnRole(turn.role), content: turn.text })),
    };
    outcome = await askChat(provider, request, {
      timeoutMs: SCENE_CHAT_REPLY_TIMEOUT_MS,
      truncatedCode: "scene_chat_reply_truncated",
    });
  } catch (err) {
    outcome = { status: "failed", error: chatFailure(err) };
  }
  try {
    await finishSceneChatReply(campaign, chatId, replyId, outcome);
  } catch (err) {
    // The database is gone (a shutdown mid-reply): the row stays `running`,
    // and the next boot fails it with the restart as its reason.
    console.error("could not record the scene chat reply", err);
  }
}

/**
 * Start writing a reply in the background. Fire and forget: the writer
 * records every failure on the reply itself.
 */
export function startSceneChatReply(
  campaign: string,
  chatId: string,
  replyId: string,
  provider: ChatProvider,
): void {
  void writeSceneChatReply(campaign, chatId, replyId, provider);
}
