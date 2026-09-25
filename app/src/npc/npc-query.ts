// The query of one npc — the key its reading view, its cards, its preview and
// its drawer share, so an npc one of them read is not asked for again.

import type { QueryKey } from "@tanstack/react-query";

import { fetchNpc } from "@/api";

/** The query key of one npc. */
export function npcKey(campaign: string, id: string): QueryKey {
  return ["npc", campaign, id];
}

/** Key and fetch of one npc, for `useQuery` and `prefetchQuery` alike. */
export function npcQuery(campaign: string, id: string) {
  return { queryKey: npcKey(campaign, id), queryFn: () => fetchNpc(campaign, id) };
}
