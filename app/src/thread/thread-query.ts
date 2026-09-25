// The query of a chapter's threads — the chapter overview and the review read
// the same key, so a thread one of them wrote is what the other shows. Its
// first segment is what the campaign's version poll invalidates.
//
// A write answers the one thread it wrote, and the cached list takes it in
// place (`withThread`) — the list is never read again for a row the server
// just handed over.

import type { Thread } from "@grimoire/shared/thread";
import type { QueryKey } from "@tanstack/react-query";

import { fetchThreads } from "./thread-api";

const LIST = "threads";

/** The first segment of every thread query key. */
export const THREAD_QUERY_ROOTS = [LIST] as const;

/** The query key of one chapter's threads. */
export function threadsKey(campaign: string, chapter: string): QueryKey {
  return [LIST, campaign, chapter];
}

/** Key and fetch of one chapter's threads. */
export function threadsQuery(campaign: string, chapter: string) {
  return { queryKey: threadsKey(campaign, chapter), queryFn: () => fetchThreads(campaign, chapter) };
}

/** The list with this thread in it: in its place when it is there, else at the end. */
export function withThread(list: readonly Thread[] | undefined, thread: Thread): Thread[] {
  const rows = list ?? [];
  return rows.some((row) => row.id === thread.id)
    ? rows.map((row) => (row.id === thread.id ? thread : row))
    : [...rows, thread];
}

/** The list without the thread of this id. */
export function withoutThread(list: readonly Thread[] | undefined, id: string): Thread[] {
  return (list ?? []).filter((row) => row.id !== id);
}
