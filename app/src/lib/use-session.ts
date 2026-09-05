// React-query hooks around the session file.
//
// TWO different questions, two hooks (issue #40):
//
//   - useActiveSession — "is a session running right now?" The SERVER answers
//     (GET /:campaign/session): the last started session without `ended`,
//     which may well be YESTERDAY's file when the evening went past midnight.
//     The app never derives that from its own date any more. `null` means
//     "nothing running" — a normal state, not an error.
//   - useSessionFile — "today's session file", still the right question for
//     the review: the harvest works on the session that was just ENDED, and
//     an ended session is by definition not active.
//
// Every write endpoint returns the fresh FileResponse: it is written into the
// cache immediately (keyed by the path the SERVER reports, never a guessed
// one) and the queries are invalidated on top — the file on disk is the truth.

import type { FileResponse } from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, fetchActiveSession, fetchFile } from "@/api";
import { todaySessionRel } from "@/lib/session";

/** Query key of the active-session lookup — also invalidated by the version
 *  poll (lib/use-campaign-version.ts), so an external edit or a session that
 *  someone ended elsewhere shows up without a reload. */
export function activeSessionKey(campaign: string): [string, string] {
  return ["active-session", campaign];
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

/** Today's session file; a 404 means "no session today" (see noSessionYet). */
export function useSessionFile(campaign: string, enabled = true) {
  return useQuery({
    queryKey: ["file", campaign, todaySessionRel()],
    queryFn: () => fetchFile(campaign, todaySessionRel()),
    enabled: enabled && campaign !== "",
    retry: false,
  });
}

/** True when the session query failed because no session was started today. */
export function noSessionYet(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Session write mutation (start/end/log/pause): seeds the caches from the
 * returned file and invalidates the session queries afterwards.
 *
 * The file cache is keyed by `data.path` — the server decides which file the
 * write landed in (issue #40: a log line goes into the RUNNING session, which
 * can be yesterday's file). The active-session cache is seeded only while the
 * returned file has no `ended`; an ended session is no longer active and must
 * not linger as a live indicator.
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
      const fileKey = ["file", campaign, data.path];
      queryClient.setQueryData(fileKey, data);
      queryClient.setQueryData(
        activeSessionKey(campaign),
        data.frontmatter.ended === undefined || data.frontmatter.ended === null ? data : null,
      );
      void queryClient.invalidateQueries({ queryKey: fileKey });
      void queryClient.invalidateQueries({ queryKey: activeSessionKey(campaign) });
      onSuccess?.(data);
    },
  });
}
