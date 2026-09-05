// Client half of issue #8: poll GET /api/:campaign/version and invalidate
// the campaign's read queries when the counter changes (the server's file
// watcher bumps it on every markdown change). No UI — data just refreshes.
//
// The same response carries the server's build id (issue #24), so this one
// poll doubles as the version handshake: every tick hands the id to
// reportServerBuild, which flips a sticky flag when it no longer matches the
// bundle this tab is running. The banner (components/UpdateBanner.tsx) reads
// that flag. No second request, no second interval.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { fetchVersion } from "@/api";
import { reportServerBuild } from "@/lib/build-id";

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
    // Build handshake first — it must run on EVERY poll, including the very
    // first one and polls where the counter did not move (a deploy changes
    // the build id, not the campaign files).
    reportServerBuild(data.build);
    const previous = last.current;
    last.current = { campaign, version: data.version };
    if (previous === null || previous.campaign !== campaign) return;
    if (previous.version === data.version) return;
    // Something changed on disk — refetch everything read from this campaign.
    // "active-session" rides along (issue #40): a session ended in another
    // tab, a hand-edited `ended`, or simply midnight passing must reach the
    // global live indicator without a reload.
    for (const key of ["tree", "file", "search", "active-session"]) {
      void queryClient.invalidateQueries({ queryKey: [key, campaign] });
    }
    // …plus the campaign list, which carries name/description from
    // `_campaign.md` (issue #17) and is keyed without a campaign segment.
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [data, campaign, queryClient]);
}
