// A chapter's open threads in the suite: `…/chapters/:chapter/threads`, the
// rows plus the LIST's own guard token — not the chapter's `rev` (ADR #26).

import type { ThreadsResponse } from "@grimoire/shared/types";
import { underCampaign, type Api } from "./api";

/** The request path of a chapter's thread list, or of one row in it. */
export function threadsPath(api: Api, chapter: string, id?: string): string {
  return id === undefined
    ? underCampaign(api, "chapters", chapter, "threads")
    : underCampaign(api, "chapters", chapter, "threads", id);
}

/** A chapter's open threads with the list's guard token. */
export function getThreads(api: Api, chapter: string): Promise<ThreadsResponse> {
  return api.get<ThreadsResponse>(threadsPath(api, chapter));
}
