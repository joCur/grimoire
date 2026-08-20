// Client half of issue #8: poll GET /api/:campaign/version and invalidate
// the campaign's read queries when the counter changes (the server's file
// watcher bumps it on every markdown change). No UI — data just refreshes.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { fetchVersion } from "@/api";

const POLL_INTERVAL_MS = 5_000;

/**
 * Mount once per campaign-scoped layout. Polls the version counter every
 * ~5s; polling pauses automatically while the tab is hidden because
 * TanStack Query's refetchIntervalInBackground defaults to false and its
 * focusManager tracks document.visibilitychange.
 */
export function useCampaignVersion(campaign: string): void {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["version", campaign],
    queryFn: () => fetchVersion(campaign),
    enabled: campaign !== "",
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });

  // Last seen counter, tagged with its campaign so a campaign switch never
  // compares counters of two different campaigns.
  const last = useRef<{ campaign: string; version: number }>(null);

  useEffect(() => {
    if (data === undefined) return;
    const previous = last.current;
    last.current = { campaign, version: data.version };
    if (previous === null || previous.campaign !== campaign) return;
    if (previous.version === data.version) return;
    // Something changed on disk — refetch everything read from this campaign.
    for (const key of ["tree", "file", "search"]) {
      void queryClient.invalidateQueries({ queryKey: [key, campaign] });
    }
    // …plus the campaign list, which carries name/description from
    // `_campaign.md` (issue #17) and is keyed without a campaign segment.
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [data, campaign, queryClient]);
}
