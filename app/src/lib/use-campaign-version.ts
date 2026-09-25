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
import { CAMPAIGN_QUERY_ROOTS } from "@/campaign/campaign-query";
import { CHAPTER_QUERY_ROOTS } from "@/chapter/chapter-query";
import { GLOSSARY_TERM_QUERY_ROOTS } from "@/glossary-term/glossary-term-query";
import { IDEA_QUERY_ROOTS } from "@/idea/idea-query";
import { KNOWLEDGE_ITEM_QUERY_ROOTS } from "@/knowledge-item/knowledge-item-query";
import { reportServerBuild } from "@/lib/build-id";
import { LOCATION_QUERY_ROOTS } from "@/location/location-query";
import { NPC_QUERY_ROOTS } from "@/npc/npc-query";
import { SCENE_QUERY_ROOTS } from "@/scene/scene-query";
import { THREAD_QUERY_ROOTS } from "@/thread/thread-query";

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
    // the build id, not the campaign).
    reportServerBuild(data.build);
    const previous = last.current;
    last.current = { campaign, version: data.version };
    if (previous === null || previous.campaign !== campaign) return;
    if (previous.version === data.version) return;
    // Something changed on the server — refetch everything read from this
    // campaign. The campaign's, a chapter's, a scene's, an npc's and a
    // location's reads name their own key roots in their slices (ADR #31). "active-session" rides along: a session
    // ended in another tab, a hand-edited `ended`, or simply midnight passing
    // must reach the global live indicator without a reload.
    // "last-session" is the review's session (ended or not) — same reasoning,
    // and "session"/"sessions" are the reads of one evening and the list of
    // evenings. The ideas and each chapter's threads name their key roots in
    // their slices too; the threads are keyed per chapter below the campaign,
    // and the prefix reaches all of them. The glossary terms, the knowledge
    // items and their order name theirs in their slices as well. An OPEN row
    // on their pages keeps the `rev` it was opened with
    // (components/EditableList.tsx), so a fresh list never turns into a
    // silent overwrite.
    for (const key of [
      "tree",
      ...CAMPAIGN_QUERY_ROOTS,
      ...CHAPTER_QUERY_ROOTS,
      ...SCENE_QUERY_ROOTS,
      ...NPC_QUERY_ROOTS,
      ...LOCATION_QUERY_ROOTS,
      "search",
      "active-session",
      "last-session",
      "session",
      "sessions",
      ...THREAD_QUERY_ROOTS,
      ...IDEA_QUERY_ROOTS,
      ...GLOSSARY_TERM_QUERY_ROOTS,
      ...KNOWLEDGE_ITEM_QUERY_ROOTS,
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key, campaign] });
    }
    // …plus the campaign list, which carries name/description from
    // `campaign` and is keyed without a campaign segment.
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }, [data, campaign, queryClient]);
}
