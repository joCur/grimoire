// The API client of a chapter (decisions/resources): its resource — read, create, write —
// and its write conflict. Built from the shared HTTP helpers (../api.ts).
//
// Which chapter is the active one is its `status`: a write that sets
// `active` makes the server put the chapter that held it back to `planned` in
// the same transaction, so there is no separate call for it.

import type { Chapter, ChapterCreate, ChapterPatch } from "@grimoire/shared/chapter";

import { ApiError, campaignPath, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's chapters, or of one of them. */
function chaptersUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/chapters`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** One chapter — every field flat, `body` among them, beside its `rev`. */
export function fetchChapter(campaign: string, id: string): Promise<Chapter> {
  return getJson<Chapter>(chaptersUrl(campaign, id));
}

/**
 * The one write of a chapter: any subset of its fields — `body` is one of
 * them, `null` clears the status — against the `rev` the editing session
 * started from. `status: "active"` makes it the active chapter, and the one
 * that was active goes back to `planned`. A stale `rev` is 409 with the
 * current chapter (`chapterConflict`); `force` writes the given fields on top
 * of it.
 */
export function patchChapter(campaign: string, id: string, request: ChapterPatch): Promise<Chapter> {
  return sendJson<Chapter>("PATCH", chaptersUrl(campaign, id), request);
}

/** The server's chapter at the moment it refused a write. */
export interface ChapterConflict {
  /** The chapter's current version — what a retry would have to carry. */
  rev: number;
  /** The current chapter; undefined when the 409 body did not carry one. */
  chapter?: Chapter;
}

/**
 * Read a chapter write conflict out of a rejection: the 409 of the chapter
 * PATCH, with the version and the chapter the server answered with.
 * `undefined` for anything else. A 409 whose body is shaped differently still
 * counts as a conflict, just without the details.
 */
export function chapterConflict(error: unknown): ChapterConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { rev, chapter } = error.details;
  return {
    rev: typeof rev === "number" ? rev : Number.NaN,
    ...(isChapter(chapter) ? { chapter } : {}),
  };
}

function isChapter(value: unknown): value is Chapter {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Chapter>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.rev === "number"
  );
}

/**
 * A new chapter at the end of the campaign, `planned` — answered as the
 * chapter itself. `body`, when given, becomes its text as typed. A taken id is
 * 409 `slug_taken` with a free proposal and writes nothing.
 */
export function createChapter(campaign: string, input: ChapterCreate): Promise<Chapter> {
  return postJson<Chapter>(chaptersUrl(campaign), {
    title: input.title,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}
