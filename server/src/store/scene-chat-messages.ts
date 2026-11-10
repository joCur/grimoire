// Scene chat messages: the message resource of a scene chat.
//
// A message is its own resource with its own type (decisions/resources,
// @grimoire/shared/scene-chat-message), hanging under its chat: written here,
// typed by its one zod schema, and read embedded in its chat. The DM's
// message is written once; the model's reply is written by the server
// (../scene-chat-reply.ts) from `running` to `done` or `failed`, and the one
// write the DM makes on a reply is the retry of a failed one. Every message
// carries its own guard `rev`, and no message write moves the chat's.
//
// One reply per chat at a time — and a scene has one live chat, so one per
// scene: a message or a retry while a reply runs is refused.

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  sceneChatMessageCreateSchema,
  sceneChatMessagePatchSchema,
  type SceneChatMessage,
  type SceneChatMessageCreate,
  type SceneChatMessagePatch,
  type SceneChatMessageStatus,
  type SceneChatRole,
} from "@grimoire/shared/scene-chat-message";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { packJson, sceneChatMessages, unpackJson } from "../db/schema";
import { mutate } from "./campaigns";
import { requireLiveSceneChatRow, storedSceneChatRowOf } from "./scene-chats";
import { nextPos, parseRequest, revConflict } from "./shared";

/** One stored message row. */
type MessageRow = typeof sceneChatMessages.$inferSelect;

// --- rendering and reading ----------------------------------------------------

/** The message of a row: every field flat, the error body of a failed reply parsed. */
function renderMessage(row: MessageRow): SceneChatMessage {
  return {
    id: row.id,
    // Both columns are CHECK constraints over the shared lists (decisions/constraints).
    role: row.role as SceneChatRole,
    text: row.text,
    status: row.status as SceneChatMessageStatus,
    ...(row.error === null ? {} : { error: unpackJson(row.error) }),
    rev: row.rev,
  };
}

function messageRowsOf(db: GrimoireDb, campaign: string, chatId: string): MessageRow[] {
  return db
    .select()
    .from(sceneChatMessages)
    .where(and(eq(sceneChatMessages.campaignId, campaign), eq(sceneChatMessages.chatId, chatId)))
    .orderBy(asc(sceneChatMessages.pos), asc(sceneChatMessages.id))
    .all();
}

/** The messages of a chat in the order they were written — what the chat embeds. */
export function chatMessages(db: GrimoireDb, campaign: string, chatId: string): SceneChatMessage[] {
  return messageRowsOf(db, campaign, chatId).map(renderMessage);
}

function messageRowOf(
  db: GrimoireDb,
  campaign: string,
  chatId: string,
  id: string,
): MessageRow | undefined {
  return db
    .select()
    .from(sceneChatMessages)
    .where(
      and(
        eq(sceneChatMessages.campaignId, campaign),
        eq(sceneChatMessages.chatId, chatId),
        eq(sceneChatMessages.id, id),
      ),
    )
    .all()[0];
}

/** 409 `scene_chat_reply_running` when a reply of this chat is still being written. */
function assertNoReplyRunning(db: GrimoireDb, campaign: string, chatId: string): void {
  if (messageRowsOf(db, campaign, chatId).some((row) => row.status === "running")) {
    throw new ApiError(409, "a reply of this chat is still being written", {
      code: "scene_chat_reply_running",
    });
  }
}

// --- writing ------------------------------------------------------------------

/** The body of a message POST, checked against the message's create form. */
export function readSceneChatMessageCreate(raw: unknown): SceneChatMessageCreate {
  return parseRequest(sceneChatMessageCreateSchema, raw, "scene chat message");
}

/** The DM's message and the reply the server now writes to it. */
export interface SentMessage {
  message: SceneChatMessage;
  reply: SceneChatMessage;
}

/**
 * POST /api/campaigns/:campaign/scene-chats/:chat/messages `{ text }` — the
 * DM's message at the end of the chat, and behind it the model's reply,
 * `running`, in the same transaction. The chat has to be live (404
 * otherwise), and no reply of it may be running (409
 * `scene_chat_reply_running`). `text` arrives trimmed and non-empty (the
 * route checks it).
 */
export async function createSceneChatMessage(
  campaign: string,
  chatId: string,
  request: SceneChatMessageCreate,
): Promise<SentMessage> {
  return mutate(campaign, (tx) => {
    requireLiveSceneChatRow(tx, campaign, chatId);
    assertNoReplyRunning(tx, campaign, chatId);
    const pos = nextPos(messageRowsOf(tx, campaign, chatId));
    const messageId = randomUUID();
    const replyId = randomUUID();
    tx.insert(sceneChatMessages)
      .values([
        { campaignId: campaign, chatId, id: messageId, role: "dm", text: request.text, status: "done", pos },
        { campaignId: campaign, chatId, id: replyId, role: "model", text: "", status: "running", pos: pos + 1 },
      ])
      .run();
    return {
      message: renderMessage(messageRowOf(tx, campaign, chatId, messageId)!),
      reply: renderMessage(messageRowOf(tx, campaign, chatId, replyId)!),
    };
  });
}

/**
 * The body of a message PATCH, checked against the message's schema: the
 * guard, `force` and `status: "running"` — a key that is none of these, or a
 * value of the wrong shape, is a 400 that names it.
 */
export function readSceneChatMessagePatch(raw: unknown): SceneChatMessagePatch {
  return parseRequest(sceneChatMessagePatchSchema, raw, "scene chat message patch");
}

/**
 * PATCH /api/campaigns/:campaign/scene-chats/:chat/messages/:id
 * `{ rev, status: "running" }` — the retry of a failed reply: it runs again,
 * its reason gone, against the chat as it stands before it. Only a failed
 * reply is retried (400 otherwise), only in a live chat (404), and not while
 * another reply runs (409 `scene_chat_reply_running`). A stale `rev` is 409
 * with the current message under `sceneChatMessage`; `force` writes on top
 * of it instead.
 */
export async function retrySceneChatMessage(
  campaign: string,
  chatId: string,
  id: string,
  patch: SceneChatMessagePatch,
): Promise<SceneChatMessage> {
  return mutate(campaign, (tx) => {
    requireLiveSceneChatRow(tx, campaign, chatId);
    const row = messageRowOf(tx, campaign, chatId, id);
    if (row === undefined) throw new ApiError(404, "scene chat message not found");
    const guard = patch.force === true ? row.rev : patch.rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "scene chat message changed", {
        sceneChatMessage: renderMessage(row),
      });
    }
    if (row.role !== "model" || row.status !== "failed") {
      throw new ApiError(400, "only a failed reply can be retried");
    }
    assertNoReplyRunning(tx, campaign, chatId);
    const next: MessageRow = { ...row, status: "running", error: null, rev: row.rev + 1 };
    writeRow(tx, next);
    return renderMessage(next);
  });
}

/** How a reply ended: its text, or the error body of its reason. */
export type ReplyOutcome =
  | { status: "done"; text: string }
  | { status: "failed"; error: Record<string, unknown> };

/**
 * The end of a running reply, written by the server: its text, or the reason
 * it failed. The reply is written whether its chat is live or in the trash —
 * a chat cleared while its reply ran keeps the reply for its restore. A reply
 * that is no longer running, or no longer there, is left alone.
 */
export async function finishSceneChatReply(
  campaign: string,
  chatId: string,
  id: string,
  outcome: ReplyOutcome,
): Promise<void> {
  await mutate(campaign, (tx) => {
    const row = messageRowOf(tx, campaign, chatId, id);
    if (row === undefined || row.status !== "running") return;
    writeRow(tx, {
      ...row,
      status: outcome.status,
      text: outcome.status === "done" ? outcome.text : "",
      error: outcome.status === "failed" ? packJson(outcome.error) : null,
      rev: row.rev + 1,
    });
  });
}

function writeRow(tx: GrimoireDb, row: MessageRow): void {
  tx.update(sceneChatMessages)
    .set({ status: row.status, text: row.text, error: row.error, rev: row.rev })
    .where(
      and(
        eq(sceneChatMessages.campaignId, row.campaignId),
        eq(sceneChatMessages.chatId, row.chatId),
        eq(sceneChatMessages.id, row.id),
      ),
    )
    .run();
}

// --- what a reply answers -------------------------------------------------------

/** What one reply is written from: its chat's scene and the turns before it. */
export interface ReplyInput {
  scene: string;
  /**
   * The written messages before the reply, in their order — the DM's and
   * the model's. A reply that failed or still runs is no turn of the
   * conversation.
   */
  turns: Array<{ role: SceneChatRole; text: string }>;
}

/**
 * The input of the reply `id` of a chat, read as it is stored at this moment;
 * undefined when the reply is no longer there or no longer running.
 */
export function sceneChatReplyInput(
  db: GrimoireDb,
  campaign: string,
  chatId: string,
  id: string,
): ReplyInput | undefined {
  const chat = storedSceneChatRowOf(db, campaign, chatId);
  if (chat === undefined) return undefined;
  const rows = messageRowsOf(db, campaign, chatId);
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1 || rows[index]!.status !== "running") return undefined;
  return {
    scene: chat.sceneId,
    turns: rows
      .slice(0, index)
      .filter((row) => row.status === "done" && row.text !== "")
      .map((row) => ({ role: row.role as SceneChatRole, text: row.text })),
  };
}
