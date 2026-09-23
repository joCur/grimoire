// The open threads of a chapter, as rows.
//
// One table (`threads`), one guard token per anchor (`chapters.threads_rev`)
// and four operations — read the list, append a thread, change one (tick,
// untick, reword) and delete one. It is a LIST and not part of the chapter
// entry (ADR #26, #29): it has no address and no `body`, a row is its
// columns, and nothing here reads or writes the chapter's text or its `rev`.
//
// THE ANCHOR is what a list hangs off. Today that is a chapter, and the three
// things that depend on it are kept together below (`anchorRev`,
// `bumpAnchorRev`, `anchorRows`): which rows belong to it, where its counter
// lives, and the 404 for an anchor that does not exist. A second anchor — a
// scene, the campaign — supplies exactly those three; the rows, their ids,
// the operations and the response shape stay as they are.

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { PatchThreadRequest, ThreadsResponse } from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { chapters, threads } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { chapterRowOf } from "./entity-rows";
import { getDb } from "./handle";
import { assertSafeChapterId, nextPos } from "./shared";

/** One stored thread row. */
interface ThreadRow {
  id: string;
  text: string;
  done: number;
  pos: number;
}

// --- the anchor ---------------------------------------------------------------

/** The list's guard token; 404 when the chapter does not exist. */
function anchorRev(tx: GrimoireDb, campaign: string, chapter: string): number {
  const row = chapterRowOf(tx, campaign, chapter);
  if (row === undefined) throw new ApiError(404, "chapter not found");
  return row.threadsRev;
}

/** Bump the list's guard token and return the new one. */
function bumpAnchorRev(tx: GrimoireDb, campaign: string, chapter: string, current: number): number {
  const next = current + 1;
  tx.update(chapters)
    .set({ threadsRev: next })
    .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, chapter)))
    .run();
  return next;
}

/** The chapter's threads in list order — `pos`, then the id as the tie-break. */
function anchorRows(db: GrimoireDb, campaign: string, chapter: string): ThreadRow[] {
  return db
    .select({ id: threads.id, text: threads.text, done: threads.done, pos: threads.pos })
    .from(threads)
    .where(and(eq(threads.campaignId, campaign), eq(threads.chapterId, chapter)))
    .orderBy(asc(threads.pos), asc(threads.id))
    .all();
}

// --- the answer ---------------------------------------------------------------

function renderThreads(rows: ThreadRow[], rev: number): ThreadsResponse {
  return {
    entries: rows.map((row) => ({ id: row.id, text: row.text, done: row.done !== 0 })),
    rev,
  };
}

/** The list as it stands, inside a running transaction. */
function currentThreads(tx: GrimoireDb, campaign: string, chapter: string): ThreadsResponse {
  return renderThreads(anchorRows(tx, campaign, chapter), anchorRev(tx, campaign, chapter));
}

/**
 * The 409 of a stale list token. It carries the CURRENT list under
 * `threads`, so the surface can show what is in the way without reading it
 * again — the list's counterpart of the `entry` an entry write hands back.
 */
function guardThreadsRev(
  tx: GrimoireDb,
  campaign: string,
  chapter: string,
  current: number,
  sent: number,
): void {
  if (current === sent) return;
  throw new ApiError(409, "open threads changed — reload before saving", {
    code: "rev_conflict",
    rev: current,
    threads: renderThreads(anchorRows(tx, campaign, chapter), current),
  });
}

/** The row with this id in THIS chapter's list; 404 otherwise. */
function requireRow(rows: ThreadRow[], id: string): ThreadRow {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new ApiError(404, "no such thread in this chapter");
  return row;
}

// --- the operations -----------------------------------------------------------

/**
 * GET …/chapters/:chapter/threads — the rows plus the list's guard token. An
 * empty list is a list (200), not a missing one; an unknown chapter is 404.
 */
export async function readThreads(campaign: string, chapter: string): Promise<ThreadsResponse> {
  assertSafeChapterId(chapter);
  await requireCampaign(campaign);
  const db = await getDb();
  return currentThreads(db, campaign, chapter);
}

/**
 * POST …/chapters/:chapter/threads — append one thread at the end of the
 * list and answer the whole list with its fresh token.
 *
 * NO `rev`, like appending an idea or a log line: an append adds a row that
 * nobody else can have edited, so there is nothing it could overwrite. A
 * guard here would turn „Handlungsstrang übernehmen" into a conflict
 * whenever the list moved in another tab after the review was opened — a
 * refusal over two writes that do not contradict each other. The counter
 * still moves, because the list did: whoever holds the old token is looking
 * at a list without this row.
 */
export async function appendThread(
  campaign: string,
  chapter: string,
  text: string,
): Promise<ThreadsResponse> {
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    const rev = anchorRev(tx, campaign, chapter);
    tx.insert(threads)
      .values({
        campaignId: campaign,
        id: randomUUID(),
        chapterId: chapter,
        text,
        done: 0,
        pos: nextPos(anchorRows(tx, campaign, chapter)),
      })
      .run();
    return renderThreads(anchorRows(tx, campaign, chapter), bumpAnchorRev(tx, campaign, chapter, rev));
  });
}

/**
 * PATCH …/chapters/:chapter/threads/:id `{ rev, text?, done? }` — tick,
 * untick or reword ONE thread, against the list's token.
 *
 * The token is checked FIRST: a caller whose list is stale gets the current
 * one (409), and only a caller who is up to date can be told that the id
 * names no row of this chapter (404) — a stale list is the likelier reason
 * for a miss, and the 409 hands back what replaced it.
 *
 * A patch that changes nothing (the row already reads so) writes nothing and
 * the token stands, like ticking an idea twice.
 */
export async function patchThread(
  campaign: string,
  chapter: string,
  id: string,
  request: PatchThreadRequest,
): Promise<ThreadsResponse> {
  if (request.text === undefined && request.done === undefined) {
    throw new ApiError(400, "nothing to write — send text or done", { code: "nothing_to_write" });
  }
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    const rev = anchorRev(tx, campaign, chapter);
    guardThreadsRev(tx, campaign, chapter, rev, request.rev);
    const rows = anchorRows(tx, campaign, chapter);
    const row = requireRow(rows, id);
    const text = request.text ?? row.text;
    const done = request.done === undefined ? row.done : request.done ? 1 : 0;
    if (text === row.text && done === row.done) return renderThreads(rows, rev);
    tx.update(threads)
      .set({ text, done })
      .where(and(eq(threads.campaignId, campaign), eq(threads.id, row.id)))
      .run();
    return renderThreads(anchorRows(tx, campaign, chapter), bumpAnchorRev(tx, campaign, chapter, rev));
  });
}

/**
 * DELETE …/chapters/:chapter/threads/:id `{ rev }` — remove ONE thread,
 * against the list's token. Same order of refusals as the patch: 409 for a
 * stale token, then 404 for an id this chapter's list does not hold.
 */
export async function deleteThread(
  campaign: string,
  chapter: string,
  id: string,
  sentRev: number,
): Promise<ThreadsResponse> {
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    const rev = anchorRev(tx, campaign, chapter);
    guardThreadsRev(tx, campaign, chapter, rev, sentRev);
    const row = requireRow(anchorRows(tx, campaign, chapter), id);
    tx.delete(threads)
      .where(and(eq(threads.campaignId, campaign), eq(threads.id, row.id)))
      .run();
    return renderThreads(anchorRows(tx, campaign, chapter), bumpAnchorRev(tx, campaign, chapter, rev));
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * Write a chapter's threads as the example campaign carries them — rows in
 * the given order, each with a fresh id. The seed has no request to answer
 * and no token to check, so it writes the rows directly, inside its own
 * transaction.
 */
export function insertThreadRows(
  tx: GrimoireDb,
  campaign: string,
  chapter: string,
  rows: ReadonlyArray<{ text: string; done?: boolean }>,
): void {
  rows.forEach((row, pos) => {
    tx.insert(threads)
      .values({
        campaignId: campaign,
        id: randomUUID(),
        chapterId: chapter,
        text: row.text,
        done: row.done === true ? 1 : 0,
        pos,
      })
      .run();
  });
}
