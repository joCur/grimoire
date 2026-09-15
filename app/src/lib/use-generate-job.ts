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
 * How long until the next poll — `false` for „nothing to wait for".
 *
 * Two reasons to keep the loop alive, and the SECOND one outranks everything
 * in the cache:
 *
 *   - a `running` job obviously has more to say.
 *   - `expectJob` means the view is WAITING for the job of a run it just
 *     started (routes/generate.tsx). Whatever sits in the cache while that is
 *     true is not that job — it is a 404 that overtook the new row (`null`),
 *     or the settled job of the PREVIOUS run. Both used to switch the
 *     interval off, and nothing switched it back on: the view sat on
 *     „Entwürfe werden generiert …" until the DM reloaded, while the run
 *     finished on the server (issues #102, #107).
 *
 * The invariant behind it: the view may not claim „working" without a live
 * poll loop — the server is the truth, so something has to keep asking it.
 */
export function generateJobPollMs(
  job: GenerateJob | null | undefined,
  expectJob = false,
): number | false {
  if (expectJob) return GENERATE_JOB_POLL_MS;
  if (job?.status === "running") return GENERATE_JOB_POLL_MS;
  return false;
}

/**
 * The campaign's generate job, or null when there is none. Polls while the
 * job is running — and while `expectJob` says a run was just started and its
 * own job is still on its way; `enabled: false` keeps a view out of it entirely
 * (the topbar switches it on where the indicator can actually show).
 */
export function useGenerateJob(
  campaign: string,
  { enabled = true, expectJob = false }: { enabled?: boolean; expectJob?: boolean } = {},
): UseQueryResult<GenerateJob | null> {
  return useQuery({
    queryKey: generateJobKey(campaign),
    queryFn: () => fetchGenerateJob(campaign),
    enabled: enabled && campaign !== "",
    // Poll only as long as there is something to wait for.
    refetchInterval: (query) => generateJobPollMs(query.state.data, expectJob),
    retry: false,
  });
}
