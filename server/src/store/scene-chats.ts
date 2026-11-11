// Scene chats: the scene chat resource.
//
// A scene chat is its own resource with its own type (decisions/resources,
// @grimoire/shared/scene-chat): listed, read, started, cleared and restored
// here, typed by its one zod schema, its messages embedded
// (./scene-chat-messages.ts). Every chat carries its own guard `rev`.
//
// A scene has at most one LIVE chat — a partial unique index says so
// (db/schema.ts). Clearing the chat puts it in the trash as one row
// (decisions/trash); a chat in the trash comes back as long as its scene is
// live and has no new chat. A scene that goes to the trash takes its live
// chat along at the same moment, and its restore brings exactly that chat
// back (./scenes.ts).

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  sceneChatCreateSchema,
  sceneChatPatchSchema,
  type SceneChat,
  type SceneChatCreate,
  type SceneChatDelete,
  type SceneChatPatch,
} from "@grimoire/shared/scene-chat";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { sceneChats } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { getDb } from "./handle";
import { chatMessages } from "./scene-chat-messages";
import { sceneRowOf, storedSceneRowOf } from "./scenes";
import { parseRequest, restoreBlocked, revConflict, trashMoment } from "./shared";
import { deletedField } from "./time";

/** One stored chat row. */
type SceneChatRow = typeof sceneChats.$inferSelect;

// --- rendering and reading ----------------------------------------------------

/** The chat of a row, its messages embedded in their order. */
function renderSceneChat(db: GrimoireDb, row: SceneChatRow): SceneChat {
  return {
    id: row.id,
    scene: row.sceneId,
    messages: chatMessages(db, row.campaignId, row.id),
    ...deletedField(row.deletedAt),
    rev: row.rev,
  };
}

/** The chat row with this id, live or in the trash. */
export function storedSceneChatRowOf(
  db: GrimoireDb,
  campaign: string,
  id: string,
): SceneChatRow | undefined {
  return db
    .select()
    .from(sceneChats)
    .where(and(eq(sceneChats.campaignId, campaign), eq(sceneChats.id, id)))
    .all()[0];
}

/** The live chat with this id; 404 when the campaign has none, or only one in the trash. */
export function requireLiveSceneChatRow(db: GrimoireDb, campaign: string, id: string): SceneChatRow {
  const row = storedSceneChatRowOf(db, campaign, id);
  if (row === undefined || row.deletedAt !== null) throw new ApiError(404, "scene chat not found");
  return row;
}

/** The live chat of a scene, if it has one. */
function liveChatRowOfScene(
  db: GrimoireDb,
  campaign: string,
  scene: string,
): SceneChatRow | undefined {
  return db
    .select()
    .from(sceneChats)
    .where(
      and(
        eq(sceneChats.campaignId, campaign),
        eq(sceneChats.sceneId, scene),
        isNull(sceneChats.deletedAt),
      ),
    )
    .all()[0];
}

/** What a list of chats asks for: one scene's, and the live ones or those in the trash. */
export interface SceneChatFilter {
  scene?: string;
  deleted: boolean;
}

/**
 * GET /api/campaigns/:campaign/scene-chats[?scene=<id>][&deleted=true] — the
 * live chats of the campaign, or of one scene (one or none), in the order
 * they were started. `deleted` lists the chats in the trash instead, the
 * latest to go there first.
 */
export async function listSceneChats(campaign: string, filter: SceneChatFilter): Promise<SceneChat[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  return db
    .select()
    .from(sceneChats)
    .where(
      and(
        eq(sceneChats.campaignId, campaign),
        filter.deleted ? isNotNull(sceneChats.deletedAt) : isNull(sceneChats.deletedAt),
        ...(filter.scene === undefined ? [] : [eq(sceneChats.sceneId, filter.scene)]),
      ),
    )
    // The row id is the order of insertion: the order the chats were started.
    .orderBy(...(filter.deleted ? [desc(sceneChats.deletedAt)] : []), asc(sql`rowid`))
    .all()
    .map((row) => renderSceneChat(db, row));
}

/** GET /api/campaigns/:campaign/scene-chats/:id — 404 for a chat in the trash. */
export async function readSceneChat(campaign: string, id: string): Promise<SceneChat> {
  await requireCampaign(campaign);
  const db = await getDb();
  return renderSceneChat(db, requireLiveSceneChatRow(db, campaign, id));
}

// --- writing ------------------------------------------------------------------

/** The body of a chat POST, checked against the chat's create form. */
export function readSceneChatCreate(raw: unknown): SceneChatCreate {
  return parseRequest(sceneChatCreateSchema, raw, "scene chat");
}

/** A started chat, and whether this request started it. */
export interface StartedSceneChat {
  chat: SceneChat;
  created: boolean;
}

/**
 * POST /api/campaigns/:campaign/scene-chats `{ scene }` — the chat of a scene,
 * empty. A scene has one live chat: when it has one, that one comes back
 * unchanged. The scene has to be live (400 otherwise): nothing is created for
 * a scene that is not there.
 */
export async function startSceneChat(
  campaign: string,
  request: SceneChatCreate,
): Promise<StartedSceneChat> {
  return mutate(campaign, (tx) => {
    if (sceneRowOf(tx, campaign, request.scene) === undefined) {
      throw new ApiError(400, `scene "${request.scene}" does not exist`);
    }
    const live = liveChatRowOfScene(tx, campaign, request.scene);
    if (live !== undefined) return { chat: renderSceneChat(tx, live), created: false };
    const id = randomUUID();
    tx.insert(sceneChats).values({ campaignId: campaign, id, sceneId: request.scene }).run();
    return { chat: renderSceneChat(tx, storedSceneChatRowOf(tx, campaign, id)!), created: true };
  });
}

/**
 * DELETE /api/campaigns/:campaign/scene-chats/:id `{ rev }` — the chat is
 * cleared: it goes to the trash with its messages (decisions/trash), and its
 * `rev` moves. A stale `rev` is 409 with the current chat under `sceneChat`;
 * a chat that is not there, or already in the trash, is 404.
 */
export async function trashSceneChat(
  campaign: string,
  id: string,
  request: SceneChatDelete,
): Promise<SceneChat> {
  return mutate(campaign, (tx) => {
    const row = requireLiveSceneChatRow(tx, campaign, id);
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "scene chat changed", { sceneChat: renderSceneChat(tx, row) });
    }
    const next: SceneChatRow = { ...row, deletedAt: trashMoment(), rev: row.rev + 1 };
    writeTrashState(tx, next);
    return renderSceneChat(tx, next);
  });
}

/** The body of a chat PATCH, checked against the chat's schema. */
export function readSceneChatPatch(raw: unknown): SceneChatPatch {
  return parseRequest(sceneChatPatchSchema, raw, "scene chat patch");
}

/**
 * PATCH /api/campaigns/:campaign/scene-chats/:id `{ rev, force?, deletedMs:
 * null }` — the chat comes back out of the trash with its messages, and its
 * `rev` moves. A scene has one chat, and a chat names its scene: one whose
 * scene is in the trash is 409 `restore_blocked` with that scene, one whose
 * scene has a new chat 409 `scene_chat_replaced` with that chat's id. A
 * stale `rev` is 409 with the current chat under `sceneChat`; `force`
 * restores on top of it. A live chat changes nothing; an unknown one is 404.
 */
export async function patchSceneChat(
  campaign: string,
  id: string,
  patch: SceneChatPatch,
): Promise<SceneChat> {
  return mutate(campaign, (tx) => {
    const row = storedSceneChatRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(404, "scene chat not found");
    if (row.rev !== (patch.force === true ? row.rev : patch.rev)) {
      throw revConflict(row.rev, "scene chat changed", { sceneChat: renderSceneChat(tx, row) });
    }
    if (row.deletedAt === null) return renderSceneChat(tx, row);
    const scene = storedSceneRowOf(tx, campaign, row.sceneId);
    if (scene !== undefined && scene.deletedAt !== null) {
      throw restoreBlocked("scene-chat", row.id, [
        { kind: "scene", id: scene.id, name: scene.title === "" ? scene.id : scene.title },
      ]);
    }
    const live = liveChatRowOfScene(tx, campaign, row.sceneId);
    if (live !== undefined) {
      throw new ApiError(409, "the scene has a new chat — nothing was restored", {
        code: "scene_chat_replaced",
        id: live.id,
      });
    }
    const next: SceneChatRow = { ...row, deletedAt: null, rev: row.rev + 1 };
    writeTrashState(tx, next);
    return renderSceneChat(tx, next);
  });
}

function writeTrashState(tx: GrimoireDb, row: SceneChatRow): void {
  tx.update(sceneChats)
    .set({ deletedAt: row.deletedAt, rev: row.rev })
    .where(and(eq(sceneChats.campaignId, row.campaignId), eq(sceneChats.id, row.id)))
    .run();
}

// --- with the scene -------------------------------------------------------------

/**
 * Put the live chat of a scene in the trash with it, INSIDE the caller's
 * transaction, at the scene's moment `at`; its `rev` moves.
 */
export function trashChatOfScene(tx: GrimoireDb, campaign: string, scene: string, at: string): void {
  const live = liveChatRowOfScene(tx, campaign, scene);
  if (live === undefined) return;
  writeTrashState(tx, { ...live, deletedAt: at, rev: live.rev + 1 });
}

/**
 * Restore the chat that went to the trash with a scene at its moment `at`,
 * INSIDE the caller's transaction; its `rev` moves. A chat the DM cleared
 * before stays in the trash — also one cleared within the same second: the
 * chat that went along is the latest one started, since a scene has one
 * live chat.
 */
export function restoreChatOfScene(tx: GrimoireDb, campaign: string, scene: string, at: string): void {
  const row = tx
    .select()
    .from(sceneChats)
    .where(
      and(
        eq(sceneChats.campaignId, campaign),
        eq(sceneChats.sceneId, scene),
        eq(sceneChats.deletedAt, at),
      ),
    )
    .orderBy(desc(sql`rowid`))
    .all()[0];
  if (row !== undefined) writeTrashState(tx, { ...row, deletedAt: null, rev: row.rev + 1 });
}

/**
 * Remove for good every chat that went to the trash before `cutoff`, across
 * all campaigns, its messages with it — the first step of the purge
 * (./trash.ts): a chat names its scene, so it goes before the scenes.
 * Returns the campaign of each removed chat.
 */
export function purgeSceneChats(tx: GrimoireDb, cutoff: string): string[] {
  const expired = and(isNotNull(sceneChats.deletedAt), lt(sceneChats.deletedAt, cutoff));
  const campaigns = tx
    .select({ campaignId: sceneChats.campaignId })
    .from(sceneChats)
    .where(expired)
    .all()
    .map((row) => row.campaignId);
  tx.delete(sceneChats).where(expired).run();
  return campaigns;
}
