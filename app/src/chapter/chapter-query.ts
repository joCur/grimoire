// The query of a chapter: the key of one chapter — its reading view, its text
// and actions in the chapter overview and its status control share it, so a
// chapter one of them read is not asked for again — and the key of the
// chapters in the trash. Their first segments are what the campaign's version
// poll invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchChapter, fetchTrashedChapters } from "./chapter-api";

const ONE = "chapter";
const TRASH = "chapter-trash";

/** The first segment of every chapter query key — one chapter, and the trash. */
export const CHAPTER_QUERY_ROOTS = [ONE, TRASH] as const;

/** The query key of one chapter. */
export function chapterKey(campaign: string, id: string): QueryKey {
  return [ONE, campaign, id];
}

/**
 * The key prefix of every chapter of a campaign. Making a chapter active
 * moves a second chapter — the one that held the status — so a write of the
 * status makes all of them stale, not only the one it answered with.
 */
export function chaptersOf(campaign: string): QueryKey {
  return [ONE, campaign];
}

/** Key and fetch of one chapter, for `useQuery` and `prefetchQuery` alike. */
export function chapterQuery(campaign: string, id: string) {
  return { queryKey: chapterKey(campaign, id), queryFn: () => fetchChapter(campaign, id) };
}

/** The query key of the campaign's chapters in the trash. */
export function chapterTrashKey(campaign: string): QueryKey {
  return [TRASH, campaign];
}

/** Key and fetch of the campaign's chapters in the trash. */
export function chapterTrashQuery(campaign: string) {
  return { queryKey: chapterTrashKey(campaign), queryFn: () => fetchTrashedChapters(campaign) };
}
