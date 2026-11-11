// The messages of a scene chat: send one, and retry a failed reply.
//
// A SCENE CHAT MESSAGE IS ITS OWN RESOURCE (decisions/resources), hanging
// under its chat: `…/scene-chats/:chat/messages` and
// `…/scene-chats/:chat/messages/:id`, answering the `SceneChatMessage` type —
// `{ id, role, text, status, error?, rev }`. The chat embeds its messages when
// it is read. The DM's message is written once; the model's reply is written
// by the server in the background (../scene-chat-reply.ts), and the app polls
// the chat until it stands. One reply per chat at a time. No message write
// moves the chat's `rev`.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { obtainChatProvider, startSceneChatReply } from "../scene-chat-reply";
import {
  createSceneChatMessage,
  readSceneChatMessageCreate,
  readSceneChatMessagePatch,
  retrySceneChatMessage,
} from "../store/scene-chat-messages";
import { jsonBody } from "./http";

export const sceneChatMessageRoutes = new Hono();

// POST /api/campaigns/:campaign/scene-chats/:chat/messages { text } -> 201 SceneChatMessage
// The DM's message at the end of the chat, answered at once. Behind it the
// model's reply stands in the chat as `running`, and the server writes it in
// the background from the context as it is stored then — the scene, its
// npcs, its location, its chapter, the campaign knowledge and the glossary —
// and the chat so far; it ends `done` with its Markdown text or `failed` with
// the reason under `error`. Leaving the page loses nothing.
//
// `text` is Markdown: trimmed, empty is 400; any other key is a 400 that
// names it. 404 for an unknown campaign or chat, and for a chat in the trash.
// While a reply of the chat runs, 409 { code: "scene_chat_reply_running" }.
// Without a configured provider, 503 { code: "llm_unconfigured" }. Nothing is
// written on any of these.
sceneChatMessageRoutes.post("/campaigns/:campaign/scene-chats/:chat/messages", async (c) => {
  const request = readSceneChatMessageCreate(await jsonBody(c, null));
  const text = request.text.trim();
  if (text === "") throw new ApiError(400, "text must be a non-empty string");
  const provider = obtainChatProvider();
  const campaign = c.req.param("campaign");
  const chat = c.req.param("chat");
  const { message, reply } = await createSceneChatMessage(campaign, chat, { text });
  startSceneChatReply(campaign, chat, reply.id, provider);
  return c.json(message, 201);
});

// PATCH /api/campaigns/:campaign/scene-chats/:chat/messages/:id
//   { rev, force?, status: "running" } -> SceneChatMessage
// RETRIES a failed reply: it runs again, its reason gone, from the chat as it
// stands before it, and is written in the background like a new one. Only a
// failed reply is retried (400 otherwise), and the reply is the one write
// the DM makes on a message: any other key, `text` among them, is a 400 that
// names it. While another reply of the chat runs, 409
// { code: "scene_chat_reply_running" }; without a configured provider, 503
// { code: "llm_unconfigured" }. A stale `rev` is 409 { code: "rev_conflict",
// rev, sceneChatMessage }; `force: true` retries on top of it. 404 for an
// unknown campaign, chat or message, and for a chat in the trash.
sceneChatMessageRoutes.patch("/campaigns/:campaign/scene-chats/:chat/messages/:id", async (c) => {
  const patch = readSceneChatMessagePatch(await jsonBody(c, null));
  const provider = obtainChatProvider();
  const campaign = c.req.param("campaign");
  const chat = c.req.param("chat");
  const reply = await retrySceneChatMessage(campaign, chat, c.req.param("id"), patch);
  startSceneChatReply(campaign, chat, reply.id, provider);
  return c.json(reply);
});
