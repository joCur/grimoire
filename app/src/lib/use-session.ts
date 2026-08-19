// React-query hooks around today's session file. The query key is the
// plain file key (["file", campaign, sessions/<today>.md]) so Topbar and
// LiveRoute share one cache entry, and every write endpoint returns the
// fresh FileResponse — it is written into the cache immediately and the
// query is invalidated on top (the server file is the truth).

import type { FileResponse } from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, fetchFile } from "@/api";
import { todaySessionRel } from "@/lib/session";

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
 * Session write mutation (start/end/log/pause): puts the returned file into
 * the cache and invalidates the session query after every write.
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
      const queryKey = ["file", campaign, todaySessionRel()];
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey });
      onSuccess?.(data);
    },
  });
}
