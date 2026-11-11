// A SCENE CHAT MESSAGE — one turn of the brainstorming chat on a scene — its
// one zod schema and the forms derived from it (decisions/resources).
//
// `sceneChatMessageSchema` is the message as its chat embeds it and as
// `POST`/`PATCH /api/campaigns/:c/scene-chats/:chat/messages[/:id]` answer
// it. The TypeScript type and the POST and the PATCH the resource accepts are
// each derived from it below with zod's own API.
//
// A message hangs UNDER its chat. The DM's message is written once. The
// model's reply is written by the server: it starts `running`, ends `done`
// with its text or `failed` with the reason, and the one write the DM makes
// on it is the retry of a failed reply.

import { z } from "zod";

/** Who wrote a message: the DM, or the model replying. */
export const SCENE_CHAT_ROLES = ["dm", "model"] as const;

export type SceneChatRole = (typeof SCENE_CHAT_ROLES)[number];

/**
 * Where a message stands: `done` once it is written (a DM's message always
 * is), `running` while the server writes the model's reply, `failed` when
 * that reply could not be written.
 */
export const SCENE_CHAT_MESSAGE_STATUSES = ["done", "running", "failed"] as const;

export type SceneChatMessageStatus = (typeof SCENE_CHAT_MESSAGE_STATUSES)[number];

/**
 * A message, exactly as the resource answers it: `id` its stable key — an
 * opaque id the server hands out —, `role` who wrote it, `text` the message
 * as Markdown (empty while a reply runs or after it failed), `status` where
 * it stands, `error` the reason a reply failed — an error body in the shape
 * of every error the server answers (`{ code, error, … }`,
 * @grimoire/shared/error-codes), absent unless `failed` —, and `rev` the row
 * version a PATCH sends back as its guard.
 */
export const sceneChatMessageSchema = z.strictObject({
  id: z.string(),
  role: z.enum(SCENE_CHAT_ROLES),
  text: z.string(),
  status: z.enum(SCENE_CHAT_MESSAGE_STATUSES),
  error: z.record(z.string(), z.unknown()).optional(),
  rev: z.number(),
});

export type SceneChatMessage = z.infer<typeof sceneChatMessageSchema>;

/**
 * The body of `POST /api/campaigns/:c/scene-chats/:chat/messages`: the DM's
 * message. Its reply is the server's.
 */
export const sceneChatMessageCreateSchema = sceneChatMessageSchema.pick({ text: true });

export type SceneChatMessageCreate = z.infer<typeof sceneChatMessageCreateSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/scene-chats/:chat/messages/:id`: the
 * guard, the optional `force`, and `status: "running"` — the retry of a
 * failed reply. Every other key, `text` among them, is a 400 naming it.
 */
export const sceneChatMessagePatchSchema = sceneChatMessageSchema
  .pick({ rev: true })
  .extend({ force: z.boolean().optional(), status: z.literal("running") });

export type SceneChatMessagePatch = z.infer<typeof sceneChatMessagePatchSchema>;
