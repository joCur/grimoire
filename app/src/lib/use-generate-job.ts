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
import { useCallback, useEffect, useRef } from "react";
import type { GenerateJob } from "@grimoire/shared/types";

import { fetchGenerateJob, putDraftEdit } from "@/api";

/** Poll cadence while a job runs (issue #19 AK4: ~3s). */
export const GENERATE_JOB_POLL_MS = 3_000;

/** Debounce before a review edit is pushed into the job store. */
export const DRAFT_EDIT_DEBOUNCE_MS = 800;

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

/**
 * Push review edits into the job store, debounced per draft path. The local
 * editor state stays authoritative while typing — this is the copy that
 * survives navigation, not the source of what is on screen, so a failed PUT
 * is swallowed instead of interrupting the review.
 *
 * On unmount whatever is still pending is sent right away: leaving the view
 * is exactly the case the ticket is about.
 */
export function useDraftEditSync(
  campaign: string,
  jobId: string | undefined,
  delayMs: number = DRAFT_EDIT_DEBOUNCE_MS,
): (path: string, markdown: string) => void {
  const pending = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Read at send time, so a debounced edit uses the CURRENT job.
  const target = useRef({ campaign, jobId });
  useEffect(() => {
    target.current = { campaign, jobId };
  }, [campaign, jobId]);

  const send = useCallback((path: string) => {
    const markdown = pending.current.get(path);
    pending.current.delete(path);
    timers.current.delete(path);
    const { campaign: forCampaign, jobId: forJob } = target.current;
    if (markdown === undefined || forJob === undefined) return;
    void putDraftEdit(forCampaign, path, markdown).catch(() => {
      // Local state keeps the edit on screen; only the restore copy is lost.
    });
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      for (const path of [...pending.current.keys()]) send(path);
    },
    [send],
  );

  return useCallback(
    (path: string, markdown: string) => {
      pending.current.set(path, markdown);
      const existing = timers.current.get(path);
      if (existing !== undefined) clearTimeout(existing);
      timers.current.set(
        path,
        setTimeout(() => send(path), delayMs),
      );
    },
    [send, delayMs],
  );
}
