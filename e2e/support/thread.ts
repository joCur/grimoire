// A thread in the suite: its resource `…/threads/:id` (decisions/resources), every field
// flat — `{ id, chapter, text, done, rev }` —, its chapter a field. Its type
// is the one `@grimoire/shared/thread` derives from the thread's schema.

import type { Thread, ThreadChange, ThreadCreate } from "@grimoire/shared/thread";
import { underCampaign, type Api } from "./api";

/** The request path of one thread, or, without an id, of the thread list. */
export function threadPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "threads") : underCampaign(api, "threads", id);
}

/** The threads of one chapter, in the order they were created. */
export function getThreads(api: Api, chapter: string): Promise<Thread[]> {
  return api.get<Thread[]>(`${threadPath(api)}?chapter=${encodeURIComponent(chapter)}`);
}

/** GET one thread from its own resource; throws when it is unknown. */
export function getThread(api: Api, id: string): Promise<Thread> {
  return api.get<Thread>(threadPath(api, id));
}

/** A new thread of a chapter — the write that adopting a plot thread in the review makes. */
export function createThread(api: Api, input: ThreadCreate): Promise<Thread> {
  return api.send<Thread>("POST", threadPath(api), input);
}

/**
 * The ONE write of a thread: PATCH its resource with `rev` and any subset of
 * its fields. Omitted, `rev` is read first — the helper then plays the second
 * writer.
 */
export async function patchThread(
  api: Api,
  id: string,
  change: ThreadChange & { rev?: number; force?: boolean },
): Promise<Thread> {
  const rev = change.rev ?? (await getThread(api, id)).rev;
  return api.send<Thread>("PATCH", threadPath(api, id), { ...change, rev });
}
