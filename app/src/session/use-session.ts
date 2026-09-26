// React-query hooks around the session: its reads and its writes.
//
// Three reads, each the server's answer — never the client's date:
//
//   - useRunningSession — "is a session running right now?"
//     (`GET …/sessions?running=true`): the last started session that is not
//     ended, which may well have started yesterday when the evening went past
//     midnight. `null` means "nothing running" — a normal state, not an error.
//   - useLastStartedSession — "which session does the review harvest?" The
//     first of the list (`GET …/sessions`, newest first): the last started
//     session, ENDED or not.
//   - useSession — one session by id, the reading page of a past evening.
//
// Every write answers the row it wrote, and that row goes straight into the
// caches (./session-query.ts). No invalidation on top — the version poll
// (lib/use-campaign-version) covers changes from elsewhere.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@grimoire/shared/session";

import { ApiError } from "@/api";

import { createLogEntry } from "./log-entry-api";
import { beginPause, endPause } from "./pause-api";
import { deleteSession, endSession, fetchSession, startSession } from "./session-api";
import {
  putSession,
  runningSessionKey,
  runningSessionQuery,
  sessionKey,
  sessionQuery,
  sessionsKey,
  sessionsQuery,
  updateSession,
  withLogEntry,
  withPause,
} from "./session-query";
import { openPause } from "./session-time";

/** ONE session by id: the reading page of an evening. */
export function useSession(campaign: string, id: string) {
  return useQuery({
    ...sessionQuery(campaign, id),
    enabled: campaign !== "" && id !== "",
    retry: false,
  });
}

/**
 * The running session, or `null` when none runs. Mounted by the topbar on
 * EVERY campaign-scoped route (the live indicator is global) and by the live
 * view — one query key, so it is one request.
 */
export function useRunningSession(campaign: string, enabled = true) {
  return useQuery({
    ...runningSessionQuery(campaign),
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/**
 * The session the REVIEW works on: the first of the list — the last started
 * one, ended or not. `null` when the campaign has no session at all
 * ("nothing to harvest").
 */
export function useLastStartedSession(campaign: string, enabled = true) {
  return useQuery({
    ...sessionsQuery(campaign),
    select: (list: Session[]) => list[0] ?? null,
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/**
 * The `code` of a start's 409 (`POST …/sessions`). Exactly ONE code exists:
 * `"session_running"` — a session of an EARLIER day is still running. An
 * ended session of today is no conflict; the start simply opens the next
 * session of the day. Undefined for anything else, so the caller can fall
 * back to a plain error message.
 */
export type SessionStartConflict = "session_running";

export function sessionStartConflict(error: unknown): SessionStartConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  return error.details.code === "session_running" ? "session_running" : undefined;
}

/** The id of the session a start's 409 points at, when the server sent one. */
export function conflictSessionId(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const id = error.details.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * "Session starten" as the state machine actually is: ONE click starts a
 * session and enters it, and exactly ONE 409 is a QUESTION rather than an
 * error — `session_running`, an older session that was never ended, because
 * ending someone else's evening is not implied by "starten". Both places that
 * offer the button (topbar and live view) ask that same question.
 *
 * There is no resume: ending a session is FINAL, so a start after an ended
 * session creates a NEW session (own id, empty log, runtime at 0).
 */
export function useSessionStartFlow(campaign: string, onEnter?: (session: Session) => void) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => startSession(campaign),
    onSuccess: (session) => {
      putSession(queryClient, campaign, session);
      onEnter?.(session);
    },
  });
  return {
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

/**
 * End a session now, against the `rev` it was read with. The ended session
 * stops being the running one and stays the first of the list — the one the
 * review harvests.
 */
export function useSessionEnd(campaign: string, onEnded?: (session: Session) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (session: Pick<Session, "id" | "rev">) => endSession(campaign, session),
    onSuccess: (session) => {
      putSession(queryClient, campaign, session);
      onEnded?.(session);
    },
    // A stale guard: the session changed elsewhere. Read it again, so the
    // next attempt carries its current `rev`.
    onError: () => void queryClient.invalidateQueries({ queryKey: runningSessionKey(campaign) }),
  });
}

/**
 * End the session a start's 409 pointed at — an older one that was never
 * ended. Its guard is read first: the start answered only its id.
 */
export function useOlderSessionEnd(campaign: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => endSession(campaign, await fetchSession(campaign, id)),
    onSuccess: (session) => putSession(queryClient, campaign, session),
  });
}

/**
 * "Session verwerfen": the session is DELETED. Offered only while
 * `isSessionEmpty` holds — the same shared predicate the server enforces, so
 * the action never leads into a 409.
 *
 * Nothing answers here (there is no session any more): nothing runs now, and
 * the list is read again — which older session is now the last started one,
 * only the server knows.
 */
export function useSessionDelete(campaign: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (session: Pick<Session, "id" | "rev">) => deleteSession(campaign, session),
    onSuccess: (_answer, session) => {
      queryClient.setQueryData(runningSessionKey(campaign), null);
      queryClient.removeQueries({ queryKey: sessionKey(campaign, session.id) });
      void queryClient.invalidateQueries({ queryKey: sessionsKey(campaign) });
      onDone?.();
    },
  });
}

/**
 * Pause and "Weiter" in ONE entry: a session without a running pause begins
 * one, a paused session ends its running pause. The pause really stops the
 * clock; it writes no log entry.
 */
export function usePauseToggle(campaign: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (session: Session) => {
      const running = openPause(session);
      return running === undefined
        ? beginPause(campaign, session.id)
        : endPause(campaign, session.id, running);
    },
    onSuccess: (pause, session) =>
      updateSession(queryClient, campaign, session.id, (current) => withPause(current, pause)),
  });
}

/** Take one quick note in the session, in the scene it was taken in. */
export function useLogEntryCreate(campaign: string, sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: { text: string; sceneId?: string }) =>
      createLogEntry(campaign, sessionId, note),
    onSuccess: (entry) =>
      updateSession(queryClient, campaign, sessionId, (session) => withLogEntry(session, entry)),
  });
}
