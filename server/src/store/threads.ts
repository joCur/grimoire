// Threads: the thread resource.
//
// A thread is its own resource with its own type (decisions/resources,
// @grimoire/shared/thread): listed, read, created, written and deleted here,
// typed by its one zod schema. It lies flat under its campaign, and the
// chapter that carries it is a field — so nothing here reads or writes a
// chapter's text or its `rev`, and a thread keeps its URL when it moves to
// another chapter.
//
// Every thread carries its own guard `rev`. There is no order to write:
// threads stand in the order they were created (`pos`, db/schema.ts).

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  threadCreateSchema,
  threadDeleteSchema,
  threadPatchSchema,
  threadSeedSchema,
  type Thread,
  type ThreadCreate,
  type ThreadDelete,
  type ThreadPatch,
  type ThreadSeed,
} from "@grimoire/shared/thread";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { threads } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { assertChapterRef } from "./entity-rows";
import { getDb } from "./handle";
import { nextPos, parseRequest, revConflict } from "./shared";

/** One stored thread row. */
type ThreadRow = typeof threads.$inferSelect;

// --- rendering and reading ----------------------------------------------------

/** The thread of a row: every field flat, `done` a boolean. */
function renderThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    chapter: row.chapterId,
    text: row.text,
    done: row.done !== 0,
    rev: row.rev,
  };
}

function threadRowOf(tx: GrimoireDb, campaign: string, id: string): ThreadRow | undefined {
  return tx
    .select()
    .from(threads)
    .where(and(eq(threads.campaignId, campaign), eq(threads.id, id)))
    .all()[0];
}

/** The thread with this id; 404 when the campaign has none. */
function requireThreadRow(tx: GrimoireDb, campaign: string, id: string): ThreadRow {
  const row = threadRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "thread not found");
  return row;
}

/**
 * GET /api/campaigns/:campaign/threads[?chapter=<id>] — the campaign's
 * threads in the order they were created (`pos`, the id as the tie-break),
 * or only those of one chapter. A chapter without threads, or one that does
 * not exist, answers an empty list: a filter names no resource.
 */
export async function listThreads(campaign: string, chapter?: string): Promise<Thread[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  const where =
    chapter === undefined
      ? eq(threads.campaignId, campaign)
      : and(eq(threads.campaignId, campaign), eq(threads.chapterId, chapter));
  return db
    .select()
    .from(threads)
    .where(where)
    .orderBy(asc(threads.pos), asc(threads.id))
    .all()
    .map(renderThread);
}

/** GET /api/campaigns/:campaign/threads/:id */
export async function readThread(campaign: string, id: string): Promise<Thread> {
  await requireCampaign(campaign);
  return renderThread(requireThreadRow(await getDb(), campaign, id));
}

// --- writing ------------------------------------------------------------------

/** The one past the highest `pos` of the campaign — where a new thread stands. */
function nextThreadPos(tx: GrimoireDb, campaign: string): number {
  return nextPos(
    tx.select({ pos: threads.pos }).from(threads).where(eq(threads.campaignId, campaign)).all(),
  );
}

/** The body of a thread POST, checked against the thread's create form. */
export function readThreadCreate(raw: unknown): ThreadCreate {
  return parseRequest(threadCreateSchema, raw, "thread");
}

/**
 * POST /api/campaigns/:campaign/threads `{ chapter, text }` — a new open
 * thread at the end, with an id the server hands out. The chapter has to
 * exist (400 `chapter_unknown`): naming one creates nothing. `text` arrives
 * as one trimmed line.
 */
export async function createThread(campaign: string, request: ThreadCreate): Promise<Thread> {
  return mutate(campaign, (tx) => {
    assertChapterRef(tx, campaign, request.chapter);
    const id = randomUUID();
    tx.insert(threads)
      .values({
        campaignId: campaign,
        id,
        chapterId: request.chapter,
        text: request.text,
        done: 0,
        pos: nextThreadPos(tx, campaign),
      })
      .run();
    return renderThread(requireThreadRow(tx, campaign, id));
  });
}

/**
 * The body of a thread PATCH, checked against the thread's schema: the
 * guard, `force` and any subset of the fields — a key that is none of these,
 * or a value of the wrong shape, is a 400 that names it.
 */
export function readThreadPatch(raw: unknown): ThreadPatch {
  return parseRequest(threadPatchSchema, raw, "thread patch");
}

/**
 * PATCH /api/campaigns/:campaign/threads/:id — any subset of the thread's
 * fields in one row update against one `rev`: tick or untick it, reword it,
 * move it to another chapter (which has to exist, 400 `chapter_unknown`). A
 * patch that names no field is 400 `nothing_to_write`; the id may be echoed,
 * never changed.
 *
 * A stale `rev` is 409 with the current thread under `thread`; `force`
 * writes the given fields on top of it instead. An unknown id is 404.
 */
export async function patchThread(campaign: string, id: string, patch: ThreadPatch): Promise<Thread> {
  const { rev, force, id: patchedId, ...fields } = patch;
  if (!Object.values(fields).some((value) => value !== undefined) && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const row = requireThreadRow(tx, campaign, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "thread changed", { thread: renderThread(row) });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    if (fields.chapter !== undefined) assertChapterRef(tx, campaign, fields.chapter);
    const next: ThreadRow = {
      ...row,
      chapterId: fields.chapter ?? row.chapterId,
      text: fields.text ?? row.text,
      done: fields.done === undefined ? row.done : fields.done ? 1 : 0,
      rev: row.rev + 1,
    };
    tx.update(threads)
      .set({ chapterId: next.chapterId, text: next.text, done: next.done, rev: next.rev })
      .where(and(eq(threads.campaignId, campaign), eq(threads.id, row.id)))
      .run();
    return renderThread(next);
  });
}

/** The body of a thread DELETE: the guard the thread was read with. */
export function readThreadDelete(raw: unknown): ThreadDelete {
  return parseRequest(threadDeleteSchema, raw, "thread delete");
}

/**
 * DELETE /api/campaigns/:campaign/threads/:id `{ rev }` — remove one thread.
 * A stale `rev` is 409 with the current thread under `thread` and removes
 * nothing; an unknown id is 404.
 */
export async function deleteThread(campaign: string, id: string, request: ThreadDelete): Promise<void> {
  await mutate(campaign, (tx) => {
    const row = requireThreadRow(tx, campaign, id);
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "thread changed", { thread: renderThread(row) });
    }
    tx.delete(threads)
      .where(and(eq(threads.campaignId, campaign), eq(threads.id, row.id)))
      .run();
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * A thread without its guard — a fixture — checked against the thread's
 * schema. A key a thread does not have, or a value of the wrong shape, is
 * refused with the message `what` introduces.
 */
export function readThreadSeed(raw: unknown, what: string): ThreadSeed {
  return parseRequest(threadSeedSchema, raw, what);
}

/**
 * Write one thread of a fixture, at the end, INSIDE the caller's
 * transaction. Its chapter is a foreign key, so a fixture naming a chapter
 * the campaign does not have is refused by the database.
 */
export function insertThreadSeed(tx: GrimoireDb, campaign: string, seed: ThreadSeed): void {
  tx.insert(threads)
    .values({
      campaignId: campaign,
      id: seed.id,
      chapterId: seed.chapter,
      text: seed.text,
      done: seed.done ? 1 : 0,
      pos: nextThreadPos(tx, campaign),
    })
    .run();
}
