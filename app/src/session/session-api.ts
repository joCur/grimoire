// The API client of a session (ADR #31): its resource — list, read, start,
// end, delete. Built from the shared HTTP helpers (../api.ts). Its children
// — pauses and log entries — are written on their own resources under it
// (./pause-api.ts, ./log-entry-api.ts) and read embedded in it.
//
// WHICH session runs is always the server's answer (`?running=true`), never
// a date the app computes: a session that runs past midnight keeps running,
// and a browser in another timezone than the server would guess wrong. A
// moment the app writes is an epoch value; the server stores its own reading
// of it.

import type { Session } from "@grimoire/shared/session";

import { campaignPath, deleteJson, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's sessions, or of one of them. */
export function sessionsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/sessions`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/**
 * Every session of the campaign, NEWEST FIRST, each with its children. The
 * first is the last started one, ended or not — the one the review harvests.
 */
export function fetchSessions(campaign: string): Promise<Session[]> {
  return getJson<Session[]>(sessionsUrl(campaign));
}

/**
 * The RUNNING session, or null when none runs — "nothing runs" is the
 * ordinary state between two evenings, not an error. The server answers a
 * list of one or none.
 */
export async function fetchRunningSession(campaign: string): Promise<Session | null> {
  const [running] = await getJson<Session[]>(`${sessionsUrl(campaign)}?running=true`);
  return running ?? null;
}

/** ONE session by its id, with its children. */
export function fetchSession(campaign: string, id: string): Promise<Session> {
  return getJson<Session>(sessionsUrl(campaign, id));
}

/**
 * Start a session now, on the server's clock. While one started today runs,
 * that one comes back; while one of an EARLIER day runs, the answer is 409
 * `session_running` naming it, and nothing starts.
 */
export function startSession(campaign: string): Promise<Session> {
  return postJson<Session>(sessionsUrl(campaign), {});
}

/**
 * End the session now, against the `rev` it was read with. An open pause
 * ends with it. A stale `rev` is 409 with the current session.
 */
export function endSession(
  campaign: string,
  session: Pick<Session, "id" | "rev">,
): Promise<Session> {
  return sendJson<Session>("PATCH", sessionsUrl(campaign, session.id), {
    rev: session.rev,
    endedMs: Date.now(),
  });
}

/**
 * Delete an EMPTY session — the undo of a mis-clicked start. One with content
 * is 409 `session_not_empty` and stays.
 */
export function deleteSession(
  campaign: string,
  session: Pick<Session, "id" | "rev">,
): Promise<void> {
  return deleteJson(sessionsUrl(campaign, session.id), { rev: session.rev });
}
