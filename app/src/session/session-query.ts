// The queries of the sessions and how a write lands in them.
//
// Three reads, one key root: the campaign's sessions (newest first — the
// review harvests the first), the RUNNING session (`?running=true`, one or
// none — the topbar chip and the live view), and ONE session by id (the
// reading page of a past evening). Their common prefix is what the
// campaign's version poll invalidates.
//
// A session embeds its children, so the session is the one cache they live
// in: a write of a pause, a log entry or a played scene answers that one row,
// and it is folded into every cached copy of its session (`withPause`,
// `withLogEntry`, `withPlayedScene`) — the session is never read again for a
// row the server just handed over. A write of the session itself answers the
// session, which replaces its cached copies.

import { isSessionEnded, type Session } from "@grimoire/shared/session";
import type { LogEntry } from "@grimoire/shared/log-entry";
import type { Pause } from "@grimoire/shared/pause";
import type { PlayedScene } from "@grimoire/shared/played-scene";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { fetchRunningSession, fetchSession, fetchSessions } from "./session-api";

const ROOT = "sessions";

/** The first segment of every session query key. */
export const SESSION_QUERY_ROOTS = [ROOT] as const;

/** The prefix of every session query of one campaign. */
export function sessionScopeKey(campaign: string): QueryKey {
  return [ROOT, campaign];
}

/** The query key of the campaign's sessions, newest first. */
export function sessionsKey(campaign: string): QueryKey {
  return [ROOT, campaign, "list"];
}

/** The query key of the running session. */
export function runningSessionKey(campaign: string): QueryKey {
  return [ROOT, campaign, "running"];
}

/** The query key of ONE session by id. */
export function sessionKey(campaign: string, id: string): QueryKey {
  return [ROOT, campaign, "one", id];
}

/** Key and fetch of the campaign's sessions. */
export function sessionsQuery(campaign: string) {
  return { queryKey: sessionsKey(campaign), queryFn: () => fetchSessions(campaign) };
}

/** Key and fetch of the running session (`null` when none runs). */
export function runningSessionQuery(campaign: string) {
  return { queryKey: runningSessionKey(campaign), queryFn: () => fetchRunningSession(campaign) };
}

/** Key and fetch of one session. */
export function sessionQuery(campaign: string, id: string) {
  return { queryKey: sessionKey(campaign, id), queryFn: () => fetchSession(campaign, id) };
}

/** The rows with this one in them: in its place when it is there, else at the end. */
function withRow<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((current) => current.id === row.id)
    ? rows.map((current) => (current.id === row.id ? row : current))
    : [...rows, row];
}

/** The session with this pause in it. */
export function withPause(session: Session, pause: Pause): Session {
  return { ...session, pauses: withRow(session.pauses, pause) };
}

/** The session with this log entry in it. */
export function withLogEntry(session: Session, entry: LogEntry): Session {
  return { ...session, log: withRow(session.log, entry) };
}

/** The session with this played scene in it. */
export function withPlayedScene(session: Session, played: PlayedScene): Session {
  return { ...session, playedScenes: withRow(session.playedScenes, played) };
}

/**
 * Fold a child's answer into every cached copy of its session: the session
 * itself, the running session when it is that one, and its place in the list.
 */
export function updateSession(
  queryClient: QueryClient,
  campaign: string,
  sessionId: string,
  fold: (session: Session) => Session,
): void {
  queryClient.setQueryData<Session>(sessionKey(campaign, sessionId), (session) =>
    session === undefined ? undefined : fold(session),
  );
  queryClient.setQueryData<Session | null>(runningSessionKey(campaign), (session) =>
    session?.id === sessionId ? fold(session) : session,
  );
  queryClient.setQueryData<Session[]>(sessionsKey(campaign), (list) =>
    list?.map((session) => (session.id === sessionId ? fold(session) : session)),
  );
}

/** Fold a log entry a write answered into its session — the review's write. */
export function putLogEntry(
  queryClient: QueryClient,
  campaign: string,
  sessionId: string,
  entry: LogEntry,
): void {
  updateSession(queryClient, campaign, sessionId, (session) => withLogEntry(session, entry));
}

/**
 * Put the session a session write answered into the caches: under its id, as
 * the running session while it is not ended (an ended one stops being the
 * live indicator), and in its place in the list. A session the list does not
 * hold yet — a new start — is where only the server knows the order, so the
 * list is read again.
 */
export function putSession(queryClient: QueryClient, campaign: string, session: Session): void {
  queryClient.setQueryData(sessionKey(campaign, session.id), session);
  queryClient.setQueryData(runningSessionKey(campaign), isSessionEnded(session) ? null : session);
  const list = queryClient.getQueryData<Session[]>(sessionsKey(campaign));
  if (list?.some((row) => row.id === session.id) === true) {
    queryClient.setQueryData<Session[]>(
      sessionsKey(campaign),
      list.map((row) => (row.id === session.id ? session : row)),
    );
  } else {
    void queryClient.invalidateQueries({ queryKey: sessionsKey(campaign) });
  }
}
