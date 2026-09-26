// The queries of a location: the key of one location — its reading view,
// its card, its preview and its drawer share it, so a location one of them
// read is not asked for again —, the key of the location list and that of
// the locations in the trash. Their first segments are what the campaign's
// version poll invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchLocation, fetchLocations, fetchTrashedLocations } from "./location-api";

const ONE = "location";
const LIST = "locations";
const TRASH = "location-trash";

/** The first segment of every location query key — one location, the list, and the trash. */
export const LOCATION_QUERY_ROOTS = [ONE, LIST, TRASH] as const;

/** The query key of one location. */
export function locationKey(campaign: string, id: string): QueryKey {
  return [ONE, campaign, id];
}

/** The query key of the campaign's location list. */
export function locationsKey(campaign: string): QueryKey {
  return [LIST, campaign];
}

/** Key and fetch of one location, for `useQuery` and `prefetchQuery` alike. */
export function locationQuery(campaign: string, id: string) {
  return { queryKey: locationKey(campaign, id), queryFn: () => fetchLocation(campaign, id) };
}

/** Key and fetch of the campaign's location list. */
export function locationsQuery(campaign: string) {
  return { queryKey: locationsKey(campaign), queryFn: () => fetchLocations(campaign) };
}

/** The query key of the campaign's locations in the trash. */
export function locationTrashKey(campaign: string): QueryKey {
  return [TRASH, campaign];
}

/** Key and fetch of the campaign's locations in the trash. */
export function locationTrashQuery(campaign: string) {
  return { queryKey: locationTrashKey(campaign), queryFn: () => fetchTrashedLocations(campaign) };
}
