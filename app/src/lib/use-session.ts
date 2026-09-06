// React-query hooks around the session file.
//
// TWO different questions, two hooks (issue #40) — and BOTH are the server's
// answer, never the client's date:
//
//   - useActiveSession — "is a session running right now?"
//     (GET /:campaign/session): the last started session that is not ended,
//     which may well be YESTERDAY's file when the evening went past midnight.
//     `null` means "nothing running" — a normal state, not an error.
//   - useLastStartedSession — "which session does the review harvest?"
//     (GET /:campaign/session?includeEnded=1): the last started session,
//     ENDED or not. Deriving today's file name here was the midnight bug of
//     the review (finding 1): `end` writes into the file the session was
//     STARTED in, so after a session that ran past midnight the harvest — and
//     every `review/seen` patch — looked at a file that does not exist.
//
// Every write endpoint returns the fresh FileResponse: it is written into the
// cache immediately (keyed by the path the SERVER reports, never a guessed
// one). No invalidation on top — the version poll (lib/use-campaign-version)
// covers external changes, and re-fetching the same file per log line was one
// redundant request per keystroke-sized write.

import type { FileResponse } from "@grimoire/shared/types";
import { isEnded } from "@grimoire/shared/session-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError,
  discardSession,
  fetchActiveSession,
  fetchLastStartedSession,
  startSession,
} from "@/api";

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
 * `null` when the campaign has no session file at all ("nothing to harvest").
 */
export function useLastStartedSession(campaign: string, enabled = true) {
  return useQuery({
    queryKey: lastStartedSessionKey(campaign),
    queryFn: () => fetchLastStartedSession(campaign),
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/** True when the session query failed because no session was started today. */
export function noSessionYet(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * The `code` of a `POST /session/start` 409 (server: store/write.ts). Exactly
 * ONE code is left since issue #58: `"session_running"` — an OLDER session is
 * still open. An already ended session of today is no conflict at all any
 * more; the start simply creates the next session of the day. Undefined for
 * anything else, so the caller can fall back to a plain error message.
 */
export type SessionStartConflict = "session_running";

export function sessionStartConflict(error: unknown): SessionStartConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  return error.details.code === "session_running" ? "session_running" : undefined;
}

/** Campaign-relative path carried by a session 409, when the server sent one. */
export function conflictPath(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const path = error.details.path;
  return typeof path === "string" ? path : undefined;
}

/**
 * Session write mutation (start/end/log/pause): seeds the caches from
 * the returned file.
 *
 * The file cache is keyed by `data.path` — the server decides which file the
 * write landed in (issue #40: a log line goes into the RUNNING session, which
 * can be yesterday's file). The active-session cache is seeded only while the
 * returned file is not ended (shared `isEnded` — the ONE predicate, so client
 * and server never disagree about a blank `ended`); an ended session is no
 * longer active and must not linger as a live indicator. The review's session
 * is seeded either way: an ended session is exactly what it harvests.
 */
export function useSessionWrite<TVars = void>(
  campaign: string,
  mutationFn: (vars: TVars) => Promise<FileResponse>,
  onSuccess?: (data: FileResponse) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(["file", campaign, data.path], data);
      queryClient.setQueryData(activeSessionKey(campaign), isEnded(data.properties) ? null : data);
      queryClient.setQueryData(lastStartedSessionKey(campaign), data);
      onSuccess?.(data);
    },
  });
}

/**
 * "Session verwerfen" (issue #40 AK7): the active session's file is DELETED.
 * Offered only while `isSessionEmpty` holds — the same shared predicate the
 * server enforces, so the action never leads into a 409.
 *
 * The cache cannot be seeded from a response here (there is no file any
 * more): the active session becomes `null` immediately, and the review's
 * session is INVALIDATED rather than nulled — after the discard the last
 * started session is an older, ended one, and only the server knows which.
 * The deleted file's own cache entry is removed so a stale copy cannot be
 * rendered from it.
 */
export function useSessionDiscard(campaign: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discardSession(campaign),
    onSuccess: (data) => {
      queryClient.removeQueries({ queryKey: ["file", campaign, data.path] });
      queryClient.setQueryData(activeSessionKey(campaign), null);
      void queryClient.invalidateQueries({ queryKey: lastStartedSessionKey(campaign) });
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
 * "Fortsetzen" is gone (issue #58): "Session beenden" is FINAL, so a start
 * after an ended session creates a NEW session (own id, empty log, runtime at
 * 0) instead of re-opening the last one.
 */
export function useSessionStartFlow(campaign: string, onEnter?: (data: FileResponse) => void) {
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
    conflictPath: conflictPath(start.error),
    /** A start that failed for any OTHER reason — a real error message. */
    failed: start.isError && sessionStartConflict(start.error) === undefined,
  };
}
