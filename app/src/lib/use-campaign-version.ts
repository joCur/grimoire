// The client half of the version poll: GET /api/campaigns/:campaign/version, then invalidate
// the campaign's read queries when the counter changes (every server-side
// write bumps it in its own transaction — nothing else changes the campaign,
// DECISIONS #9/#13). No UI — data just refreshes.
//
// The same response carries the server's build id, so this one
// poll doubles as the version handshake: every tick hands the id to
// reportServerBuild, which flips a sticky flag when it no longer matches the
// bundle this tab is running. The banner (components/UpdateBanner.tsx) reads
// that flag. No second request, no second interval.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { fetchVersion } from "@/api";
import { reportServerBuild } from "@/lib/build-id";
import { LOCATION_QUERY_ROOTS } from "@/location/location-query";
import { NPC_QUERY_ROOTS } from "@/npc/npc-query";
import { SCENE_QUERY_ROOTS } from "@/scene/scene-query";

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
    // the build id, not the campaign entries).
    reportServerBuild(data.build);
    const previous = last.current;
    last.current = { campaign, version: data.version };
    if (previous === null || previous.campaign !== campaign) return;
    if (previous.version === data.version) return;
    // Something changed on the server — refetch everything read from this
    // campaign. A scene's, an npc's and a location's reads name their own key
    // roots in their slices (ADR #31). "active-session" rides along: a session
    // ended in another tab, a hand-edited `ended`, or simply midnight passing
    // must reach the global live indicator without a reload.
    // "last-session" is the review's session (ended or not) — same reasoning,
    // and "session"/"sessions"/"inbox" are the reads of one evening, the list
    // of evenings and the ideas thrown in from the phone.
    // "threads" are the open threads of each chapter, keyed per chapter
    // below the campaign — the prefix reaches all of them.
    // "knowledge"/"glossary" are campaign reads like the rest:
    // the two content pages have to learn about a write from another tab.
    // NOTE what that means for an OPEN row there: the list under it changes.
    // components/EntryListPage.tsx therefore addresses its save by the
    // entry's CONTENT and sends the `rev` that applied when the row was
    // opened — a fresh list must not turn into a silent overwrite.
    for (const key of [
      "tree",
      "entry",
      ...SCENE_QUERY_ROOTS,
      ...NPC_QUERY_ROOTS,
      ...LOCATION_QUERY_ROOTS,
      "search",
      "active-session",
      "last-session",
      "session",
      "sessions",
      "inbox",
      "threads",
      "knowledge",
      "glossary",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key, campaign] });
    }
    // …plus the campaign list, which carries name/description from
    // `campaign` and is keyed without a campaign segment.
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [data, campaign, queryClient]);
}
