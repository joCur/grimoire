// A SCENE CHAT — the DM's brainstorming chat with the model on one scene —
// its one zod schema and the forms derived from it (decisions/resources).
//
// `sceneChatSchema` is the chat as `GET /api/campaigns/:c/scene-chats/:id`
// answers it: its own fields with its messages embedded (./scene-chat-message.ts).
// The messages do not exist without their chat, and each is written on its
// own resource under it; no chat write touches them. The TypeScript type,
// the POST, the PATCH and the DELETE the resource accepts are each derived
// from it below with zod's own API.
//
// A scene has at most one live chat. Clearing the chat is its DELETE, which
// puts it in the trash as one row (decisions/trash); a message sent after
// that starts a new chat. A chat in the trash comes back with a PATCH of
// `deletedMs: null`, as long as its scene has no new chat.

import { z } from "zod";
import { sceneChatMessageSchema } from "./scene-chat-message";

/**
 * A chat, exactly as the resource answers it: `id` its stable key — an
 * opaque id the server hands out —, `scene` the scene it is about, `messages`
 * its messages in the order they were written, `deletedMs` when it went to
 * the trash — absent while it is live (decisions/trash) —, and `rev` the row
 * version a PATCH or a DELETE sends back as its guard. It guards the chat's
 * own fields: a message carries its own.
 */
export const sceneChatSchema = z.strictObject({
  id: z.string(),
  scene: z.string(),
  messages: z.array(sceneChatMessageSchema),
  deletedMs: z.number().optional(),
  rev: z.number(),
});

export type SceneChat = z.infer<typeof sceneChatSchema>;

/**
 * The body of `POST /api/campaigns/:c/scene-chats`: the scene the chat is
 * about. A new chat is empty.
 */
export const sceneChatCreateSchema = sceneChatSchema.pick({ scene: true });

export type SceneChatCreate = z.infer<typeof sceneChatCreateSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/scene-chats/:id`: the guard, the
 * optional `force`, and `deletedMs: null`, which takes the chat out of the
 * trash. Putting it there is its DELETE, and its messages are written on
 * their own resource, so a chat takes no other write: every other key is a
 * 400 naming it.
 */
export const sceneChatPatchSchema = sceneChatSchema
  .pick({ rev: true })
  .extend({ force: z.boolean().optional(), deletedMs: z.null() });

export type SceneChatPatch = z.infer<typeof sceneChatPatchSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/scene-chats/:id`, which clears the
 * chat by putting it in the trash: the guard the chat was read with.
 */
export const sceneChatDeleteSchema = sceneChatSchema.pick({ rev: true });

export type SceneChatDelete = z.infer<typeof sceneChatDeleteSchema>;
