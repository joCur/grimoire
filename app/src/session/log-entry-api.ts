// The API client of a log entry (decisions/resources): its resource under its session —
// take a quick note, review it.

import type { LogEntry } from "@grimoire/shared/log-entry";

import { postJson, sendJson } from "@/api";

import { sessionsUrl } from "./session-api";

/** The request path of a session's log, or of one of its entries. */
function logUrl(campaign: string, sessionId: string, id?: string): string {
  const base = `${sessionsUrl(campaign, sessionId)}/log`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/**
 * Take one quick note in the session, in the scene it was taken in. The time
 * is the server's. An ended session takes no note: 409 `session_ended`.
 */
export function createLogEntry(
  campaign: string,
  sessionId: string,
  note: { text: string; sceneId?: string },
): Promise<LogEntry> {
  return postJson<LogEntry>(logUrl(campaign, sessionId), note);
}

/**
 * Mark ONE log entry as reviewed, against the `rev` it was read with. A stale
 * `rev` is 409 with the current entry; nothing is written.
 */
export function reviewLogEntry(
  campaign: string,
  sessionId: string,
  entry: Pick<LogEntry, "id" | "rev">,
): Promise<LogEntry> {
  return sendJson<LogEntry>("PATCH", logUrl(campaign, sessionId, entry.id), {
    rev: entry.rev,
    reviewed: true,
  });
}
