// The queries of an npc: the key of one npc — its reading view, its cards,
// its preview and its drawer share it, so an npc one of them read is not
// asked for again —, the key of the npc list and that of the npcs in the
// trash. Their first segments are what the campaign's version poll
// invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchNpc, fetchNpcs, fetchTrashedNpcs } from "./npc-api";

const ONE = "npc";
const LIST = "npcs";
const TRASH = "npc-trash";

/** The first segment of every npc query key — one npc, the list, and the trash. */
export const NPC_QUERY_ROOTS = [ONE, LIST, TRASH] as const;

/** The query key of one npc. */
export function npcKey(campaign: string, id: string): QueryKey {
  return [ONE, campaign, id];
}

/** The query key of the campaign's npc list. */
export function npcsKey(campaign: string): QueryKey {
  return [LIST, campaign];
}

/** Key and fetch of one npc, for `useQuery` and `prefetchQuery` alike. */
export function npcQuery(campaign: string, id: string) {
  return { queryKey: npcKey(campaign, id), queryFn: () => fetchNpc(campaign, id) };
}

/** Key and fetch of the campaign's npc list. */
export function npcsQuery(campaign: string) {
  return { queryKey: npcsKey(campaign), queryFn: () => fetchNpcs(campaign) };
}

/** The query key of the campaign's npcs in the trash. */
export function npcTrashKey(campaign: string): QueryKey {
  return [TRASH, campaign];
}

/** Key and fetch of the campaign's npcs in the trash. */
export function npcTrashQuery(campaign: string) {
  return { queryKey: npcTrashKey(campaign), queryFn: () => fetchTrashedNpcs(campaign) };
}
