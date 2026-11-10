// The chats on scenes: list, read, start, clear and restore.
//
// A SCENE CHAT IS ITS OWN RESOURCE (decisions/resources): `…/scene-chats` and
// `…/scene-chats/:id`, answering the `SceneChat` type — `{ id, scene,
// messages, deletedMs?, rev }`, its messages embedded; they are written on
// their own resource below it (./scene-chat-messages.ts). A chat lies flat
// under its campaign with its scene as a field: it is cleared into the trash
// on its own, and the trash page lists the cleared chats of every scene. A
// scene has at most one live chat. No message write moves the chat's `rev`.

import { Hono } from "hono";
import { sceneChatDeleteSchema } from "@grimoire/shared/scene-chat";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import { ApiError } from "../api-error";
import {
  listSceneChats,
  patchSceneChat,
  readSceneChat,
  readSceneChatCreate,
  readSceneChatPatch,
  startSceneChat,
  trashSceneChat,
} from "../store/scene-chats";
import { parseRequest } from "../store/shared";
import { deletedFilter, jsonBody } from "./http";

export const sceneChatRoutes = new Hono();

// GET /api/campaigns/:campaign/scene-chats[?scene=<id>][&deleted=true] -> SceneChat[]
// The live chats of the campaign in the order they were started; with
// `scene`, the live chat of that scene — one or none. No chat answers an
// empty list (200). `?deleted=true` answers the chats in the trash instead,
// each with its `deletedMs`, the latest to go there first — the cleared ones
// and those that went with their scene. Any other value of `deleted` is a
// 400. 404 for an unknown campaign.
sceneChatRoutes.get("/campaigns/:campaign/scene-chats", async (c) => {
  const scene = c.req.query("scene");
  return c.json(
    await listSceneChats(c.req.param("campaign"), {
      ...(scene === undefined ? {} : { scene }),
      deleted: deletedFilter(c.req.query("deleted")),
    }),
  );
});

// GET /api/campaigns/:campaign/scene-chats/:id -> SceneChat
// The chat with its messages in their order. 404 for an unknown campaign or
// chat, and for a chat in the trash.
sceneChatRoutes.get("/campaigns/:campaign/scene-chats/:id", async (c) =>
  c.json(await readSceneChat(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/scene-chats { scene } -> 201 SceneChat
// Starts the chat of a scene, empty, with an id the server hands out. A
// scene has one live chat: when it has one, that one comes back unchanged
// (200). `scene` is a slug that has to name a live scene of the campaign (400
// otherwise); any other key is a 400 that names it. No `rev`: a new chat
// overwrites nothing.
sceneChatRoutes.post("/campaigns/:campaign/scene-chats", async (c) => {
  const request = readSceneChatCreate(await jsonBody(c, null));
  if (!ENTITY_SLUG.test(request.scene)) {
    throw new ApiError(400, "scene must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  const { chat, created } = await startSceneChat(c.req.param("campaign"), request);
  return c.json(chat, created ? 201 : 200);
});

// PATCH /api/campaigns/:campaign/scene-chats/:id { rev, force?, deletedMs: null } -> SceneChat
// RESTORE: takes the chat out of the trash with its messages, its `rev`
// moved. It is the one write a chat takes — its messages are written on
// their own resource —, so any other key is a 400 that names it. A scene has
// one chat: while the scene has a new one, the restore is 409
// { code: "scene_chat_replaced", id } with that chat's id; while the scene is
// in the trash, 409 { code: "restore_blocked", kind, id, blockers } naming
// it. Nothing is written then. A stale `rev` is 409 { code: "rev_conflict",
// rev, sceneChat }; `force: true` restores on top of it. On a live chat it
// changes nothing. 404 for an unknown campaign or chat.
sceneChatRoutes.patch("/campaigns/:campaign/scene-chats/:id", async (c) => {
  const patch = readSceneChatPatch(await jsonBody(c, null));
  return c.json(await patchSceneChat(c.req.param("campaign"), c.req.param("id"), patch));
});

// DELETE /api/campaigns/:campaign/scene-chats/:id { rev } -> SceneChat
// CLEARS the chat: it goes to the TRASH (decisions/trash) with its messages
// and answers with its `deletedMs` and its moved `rev`; the scene then has no
// chat until the DM writes again, and the trash removes it for good after
// its retention. A reply still running is written into it all the same. A
// stale `rev` is 409 { code: "rev_conflict", rev, sceneChat }. 404 for an
// unknown campaign or chat, and for one already in the trash.
sceneChatRoutes.delete("/campaigns/:campaign/scene-chats/:id", async (c) => {
  const request = parseRequest(sceneChatDeleteSchema, await jsonBody(c, null), "scene chat delete");
  return c.json(await trashSceneChat(c.req.param("campaign"), c.req.param("id"), request));
});
