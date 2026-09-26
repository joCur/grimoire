// The API client of a pause (decisions/resources): its resource under its session —
// begin and end. A pause is an interval of the session's clock: while one is
// open, the clock stands.

import type { Pause } from "@grimoire/shared/pause";

import { postJson, sendJson } from "@/api";

import { sessionsUrl } from "./session-api";

/** The request path of a session's pauses, or of one of them. */
function pausesUrl(campaign: string, sessionId: string, id?: string): string {
  const base = `${sessionsUrl(campaign, sessionId)}/pauses`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/**
 * Begin a pause now, on the server's clock. While one is open, that one comes
 * back. An ended session takes no pause: 409 `session_ended`.
 */
export function beginPause(campaign: string, sessionId: string): Promise<Pause> {
  return postJson<Pause>(pausesUrl(campaign, sessionId), {});
}

/** End the pause now, against the `rev` it was read with. */
export function endPause(
  campaign: string,
  sessionId: string,
  pause: Pick<Pause, "id" | "rev">,
): Promise<Pause> {
  return sendJson<Pause>("PATCH", pausesUrl(campaign, sessionId, pause.id), {
    rev: pause.rev,
    toMs: Date.now(),
  });
}
