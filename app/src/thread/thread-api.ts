// The API client of a thread (decisions/resources): its resource — list, create, write,
// delete. Built from the shared HTTP helpers (../api.ts).
//
// A thread lies flat under its campaign, and its chapter is a field, so no
// thread write touches the chapter or its `rev`.

import type { Thread, ThreadChange, ThreadCreate } from "@grimoire/shared/thread";

import { campaignPath, deleteJson, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's threads, or of one of them. */
function threadsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/threads`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** The threads of one chapter, in the order they were created. */
export function fetchThreads(campaign: string, chapter: string): Promise<Thread[]> {
  return getJson<Thread[]>(`${threadsUrl(campaign)}?chapter=${encodeURIComponent(chapter)}`);
}

/**
 * A new open thread at the end of its chapter — adopting a plot thread in the
 * review and the overview's add action. No `rev`: a new thread overwrites
 * nothing.
 */
export function createThread(campaign: string, input: ThreadCreate): Promise<Thread> {
  return postJson<Thread>(threadsUrl(campaign), input);
}

/**
 * Tick, untick or reword ONE thread against the `rev` it was read with. A
 * stale `rev` is 409 with the current thread; nothing is written.
 */
export function patchThread(
  campaign: string,
  id: string,
  rev: number,
  change: ThreadChange,
): Promise<Thread> {
  return sendJson<Thread>("PATCH", threadsUrl(campaign, id), { ...change, rev });
}

/** Delete ONE thread against the `rev` it was read with; same 409 as the patch. */
export function deleteThread(campaign: string, id: string, rev: number): Promise<void> {
  return deleteJson(threadsUrl(campaign, id), { rev });
}
