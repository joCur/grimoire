// Client half of issue #19: the generator run lives on the SERVER, so the
// browser tab is free to go. Everything here is about picking that run back
// up — nothing about it is stored locally (DECISIONS #3: no persistent
// browser state; the server is the truth).
//
// One query key per campaign, shared by the generator route and the topbar's
// run indicator. Because both observers sit on the SAME key there is exactly
// one poll loop: TanStack Query runs one interval per query, and the
// interval only exists while the job is running — a finished job needs no
// polling, and no job at all needs none either.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GenerateJob } from "@grimoire/shared/types";

import { fetchGenerateJob } from "@/api";

/** Poll cadence while a job runs (issue #19 AK4: ~3s). */
export const GENERATE_JOB_POLL_MS = 3_000;

/** The one query key — reused verbatim so nothing polls twice. */
export function generateJobKey(campaign: string): [string, string] {
  return ["generate-job", campaign];
}

/**
 * The campaign's generate job, or null when there is none. Polls only while
 * the job is running; `enabled: false` keeps a view out of it entirely (the
 * topbar switches it on where the indicator can actually show).
 */
export function useGenerateJob(
  campaign: string,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<GenerateJob | null> {
  return useQuery({
    queryKey: generateJobKey(campaign),
    queryFn: () => fetchGenerateJob(campaign),
    enabled: enabled && campaign !== "",
    // Poll only as long as there is something to wait for.
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? GENERATE_JOB_POLL_MS : false,
    retry: false,
  });
}
