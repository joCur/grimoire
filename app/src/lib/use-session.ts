// React-query hooks around the session.
//
// TWO different questions, two hooks — and BOTH are the server's
// answer, never the client's date:
//
//   - useActiveSession — "is a session running right now?"
//     (GET /campaigns/:campaign/session): the last started session that is not ended,
//     which may well be YESTERDAY's session when the evening went past midnight.
//     `null` means "nothing running" — a normal state, not an error.
//   - useLastStartedSession — "which session does the review harvest?"
//     (GET /campaigns/:campaign/session?includeEnded=1): the last started session,
//     ENDED or not. Today's session id is NOT derived here: `end` writes into
//     the session that was STARTED in, so after a session that ran past
//     midnight a derived id — for the harvest and for every `review/seen`
//     patch — would name a session that does not exist.
//
// Every write endpoint returns the fresh SessionResponse: it is written into
// the caches immediately. No invalidation on top — the version poll
// (lib/use-campaign-version) covers external changes, and re-fetching the same
// session per log row would be one redundant request per keystroke-sized
// write.

import type { SessionResponse } from "@grimoire/shared/types";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError,
  discardSession,
  fetchActiveSession,
  fetchLastStartedSession,
  fetchSession,
  fetchSessions,
  startSession,
} from "@/api";
import { sessionIsEnded } from "@/lib/session";

/** Query key of the active-session lookup — also invalidated by the version
 *  poll (lib/use-campaign-version.ts), so an external edit or a session that
 *  someone ended elsewhere shows up without a reload. */
export function activeSessionKey(campaign: string): [string, string] {
  return ["active-session", campaign];
}

/** Query key of the review's session (the last started one, ended or not). */
export function lastStartedSessionKey(campaign: string): [string, string] {
  return ["last-session", campaign];
}

/** Query key of ONE session by id — the reading page of a past evening. */
export function sessionKey(campaign: string, id: string): [string, string, string] {
  return ["session", campaign, id];
}

/** ONE session by id: the reading page of an evening that is over. */
export function useSession(campaign: string, id: string) {
  return useQuery({
    queryKey: sessionKey(campaign, id),
    queryFn: () => fetchSession(campaign, id),
    enabled: campaign !== "" && id !== "",
    retry: false,
  });
}

/** The campaign's sessions, newest first. */
export function useSessions(campaign: string, enabled = true) {
  return useQuery({
    queryKey: ["sessions", campaign],
    queryFn: () => fetchSessions(campaign),
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/**
 * The running session, or `null` when none runs. Mounted by the topbar on
 * EVERY campaign-scoped route (the live indicator is global) and by the live
 * view — one query key, so it is one request.
 */
export function useActiveSession(campaign: string, enabled = true) {
  return useQuery({
    queryKey: activeSessionKey(campaign),
    queryFn: () => fetchActiveSession(campaign),
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/**
 * The session the REVIEW works on: the last started one, ended or not.
 * `null` when the campaign has no session at all ("nothing to harvest").
 */
export function useLastStartedSession(campaign: string, enabled = true) {
  return useQuery({
    queryKey: lastStartedSessionKey(campaign),
    queryFn: () => fetchLastStartedSession(campaign),
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/**
 * The `code` of a `POST /session/start` 409 (server: store/sessions.ts). Exactly
 * ONE code exists: `"session_running"` — an OLDER session is still open. An
 * already ended session of today is no conflict; the start simply creates the
 * next session of the day. Undefined for anything else, so the caller can fall
 * back to a plain error message.
 */
export type SessionStartConflict = "session_running";

export function sessionStartConflict(error: unknown): SessionStartConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  return error.details.code === "session_running" ? "session_running" : undefined;
}

/**
 * The session id a start 409 points at, when the server sent one. The session
 * endpoints name a session by `id` — a list row has no address (ADR #26), so
 * there is no second name to look under.
 */
export function conflictSessionId(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const id = error.details.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Session write mutation (start/end/log/pause): seeds the caches from
 * the returned session.
 *
 * The server decides which session the write landed in: a log row goes into
 * the RUNNING session, which can be yesterday's — so the answer is seeded
 * under the id the server reports, never a guessed one. The active-session
 * cache is seeded only while the returned session is not ended; an ended
 * session is no longer active and must not linger as a live indicator. The
 * review's session is seeded either way: an ended session is exactly what it
 * harvests.
 */
export function useSessionWrite<TVars = void>(
  campaign: string,
  mutationFn: (vars: TVars) => Promise<SessionResponse>,
  onSuccess?: (data: SessionResponse) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(sessionKey(campaign, data.id), data);
      queryClient.setQueryData(activeSessionKey(campaign), sessionIsEnded(data) ? null : data);
      queryClient.setQueryData(lastStartedSessionKey(campaign), data);
      onSuccess?.(data);
    },
  });
}

/**
 * Write a session answer into every cache that shows it: the session itself,
 * the review's session, and the active-session slot — the last one only while
 * the session is not ended, so an ended evening stops being the live
 * indicator. Used by the review writes, which answer with a session without
 * being a session verb.
 */
export function seedSession(
  queryClient: QueryClient,
  campaign: string,
  session: SessionResponse,
): void {
  queryClient.setQueryData(sessionKey(campaign, session.id), session);
  queryClient.setQueryData(lastStartedSessionKey(campaign), session);
  if (!sessionIsEnded(session)) {
    queryClient.setQueryData(activeSessionKey(campaign), session);
  }
}

/**
 * "Session verwerfen": the active session is DELETED. Offered only while
 * `isSessionEmpty` holds — the same shared predicate the server enforces, so
 * the action never leads into a 409.
 *
 * The cache cannot be seeded from a response here (there is no session any
 * more): the active session becomes `null` immediately, and the review's
 * session is INVALIDATED rather than nulled — after the discard the last
 * started session is an older, ended one, and only the server knows which.
 * The session list follows for the same reason.
 */
export function useSessionDiscard(campaign: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discardSession(campaign),
    onSuccess: () => {
      queryClient.setQueryData(activeSessionKey(campaign), null);
      void queryClient.invalidateQueries({ queryKey: lastStartedSessionKey(campaign) });
      void queryClient.invalidateQueries({ queryKey: ["sessions", campaign] });
      onDone?.();
    },
  });
}

/**
 * "Session starten" as the state machine actually is: ONE click starts a
 * session and enters it, and exactly ONE 409 is a QUESTION rather than an
 * error — `session_running`, an OLDER session that was never ended, because
 * ending someone else's evening is not implied by "starten". Both places that
 * offer the button (topbar and live view) ask that same question.
 *
 * There is no resume: "Session beenden" is FINAL, so a start after an ended
 * session creates a NEW session (own id, empty log, runtime at 0) instead of
 * re-opening the last one.
 */
export function useSessionStartFlow(campaign: string, onEnter?: (data: SessionResponse) => void) {
  const start = useSessionWrite(campaign, () => startSession(campaign), onEnter);
  return {
    start,
    /** ONE click into a session — always a start, never a resume. */
    enter: () => {
      if (start.isPending) return;
      start.mutate();
    },
    /** True while `enter` is in flight. */
    entering: start.isPending,
    /** The 409 the LAST start answered with, when it was the documented one. */
    conflict: sessionStartConflict(start.error),
    /** The session that 409 pointed at (the older, still running one). */
    conflictSessionId: conflictSessionId(start.error),
    /** A start that failed for any OTHER reason — a real error message. */
    failed: start.isError && sessionStartConflict(start.error) === undefined,
  };
}
