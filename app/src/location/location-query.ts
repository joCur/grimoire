// The query of one location — the key its reading view, its card, its
// preview and its drawer share, so a location one of them read is not asked
// for again.

import type { QueryKey } from "@tanstack/react-query";

import { fetchLocation } from "@/api";

/** The query key of one location. */
export function locationKey(campaign: string, id: string): QueryKey {
  return ["location", campaign, id];
}

/** Key and fetch of one location, for `useQuery` and `prefetchQuery` alike. */
export function locationQuery(campaign: string, id: string) {
  return { queryKey: locationKey(campaign, id), queryFn: () => fetchLocation(campaign, id) };
}
