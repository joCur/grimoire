// The query of a chapter: the key of one chapter — its reading view, its text
// and actions in the chapter overview and its status control share it, so a
// chapter one of them read is not asked for again. Its first segment is what
// the campaign's version poll invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchChapter } from "./chapter-api";

const ONE = "chapter";

/** The first segment of every chapter query key. */
export const CHAPTER_QUERY_ROOTS = [ONE] as const;

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
