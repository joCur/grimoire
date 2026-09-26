// The campaign's generator job, read from its resource
// (`GET …/generator-jobs`, a list of one or none). The run lives on the
// SERVER, so the browser tab is free to go; everything here is about picking
// that run back up — nothing about it is stored locally (DECISIONS #3: no
// persistent browser state; the server is the truth).
//
// One query key per campaign, shared by the generator route and the topbar's
// run indicator. Because both observers sit on the SAME key there is exactly
// one poll loop: TanStack Query runs one interval per query, and the
// interval only exists while the job is running — a finished job needs no
// polling, and no job at all needs none either.

import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

import { deleteGeneratorJob, fetchGeneratorJob } from "@/api";

/** Poll cadence while a job runs. */
export const GENERATOR_JOB_POLL_MS = 3_000;

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
 *     or the settled job of the PREVIOUS run. Neither may switch the
 *     interval off, because nothing would switch it back on while the run
 *     finishes on the server.
 *
 * The invariant behind it: the view may not claim „working" without a live
 * poll loop — the server is the truth, so something has to keep asking it.
 */
export function generateJobPollMs(
  job: GeneratorJob | null | undefined,
  expectJob = false,
): number | false {
  if (expectJob) return GENERATOR_JOB_POLL_MS;
  if (job?.status === "running") return GENERATOR_JOB_POLL_MS;
  return false;
}

/** Options accepted by the job query. */
export type GeneratorJobOptions = { enabled?: boolean; expectJob?: boolean };

/**
 * The query options behind `useGenerateJob`, exported so the polling
 * contract can be asserted without mounting a component.
 *
 * `refetchIntervalInBackground: true` is the load-bearing part. TanStack
 * Query suspends refetch intervals while `document.visibilityState` is
 * "hidden" unless this flag is set, so a run that finishes while the DM is
 * reading something in another tab would sit unnoticed on the server until
 * this tab regained focus — the view keeps claiming "working" in the
 * meantime. A run's completion has to be picked up on its own, so this
 * loop must survive a hidden tab. Unlike the version poll, it is bounded:
 * the interval exists only while a run is in flight (see
 * `generateJobPollMs`), so a background tab with no run polls nothing.
 */
export function generateJobQueryOptions(
  campaign: string,
  { enabled = true, expectJob = false }: GeneratorJobOptions = {},
) {
  return {
    queryKey: generateJobKey(campaign),
    queryFn: () => fetchGeneratorJob(campaign),
    enabled: enabled && campaign !== "",
    // Poll only as long as there is something to wait for.
    refetchInterval: (query: { state: { data: GeneratorJob | null | undefined } }) =>
      generateJobPollMs(query.state.data, expectJob),
    refetchIntervalInBackground: true,
    retry: false,
  };
}

/**
 * The campaign's generator job, or null when there is none. Polls while the
 * job is running — and while `expectJob` says a run was just started and its
 * own job is still on its way; `enabled: false` keeps a view out of it entirely
 * (the topbar switches it on where the indicator can actually show).
 */
export function useGenerateJob(
  campaign: string,
  options: GeneratorJobOptions = {},
): UseQueryResult<GeneratorJob | null> {
  return useQuery(generateJobQueryOptions(campaign, options));
}

/**
 * Discard the campaign's job as the cache knows it — its id and the `rev` it
 * was read with. A caller with a pending review flushes it first, so the
 * guard is the one the last patch answered with. Nothing cached, nothing to
 * discard.
 */
export async function discardGeneratorJob(
  queryClient: QueryClient,
  campaign: string,
): Promise<void> {
  const job = queryClient.getQueryData<GeneratorJob | null>(generateJobKey(campaign));
  if (job !== undefined && job !== null) await deleteGeneratorJob(campaign, job);
}
