// A location in the suite: its resource `…/locations/:id` (decisions/resources), every field
// flat, `body` among them, beside its guard. Its type is the one
// `@grimoire/shared/location` derives from the location's schema.

import type { Location, LocationChange } from "@grimoire/shared/location";
import { exists, underCampaign, type Api } from "./api";

/** The request path of one location, or, without an id, of the location list. */
export function locationPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "locations") : underCampaign(api, "locations", id);
}

/** GET one location from its own resource; throws when it is unknown. */
export function getLocation(api: Api, id: string): Promise<Location> {
  return api.get<Location>(locationPath(api, id));
}

/** Whether the campaign has a location with that id (404 = no). */
export function locationExists(api: Api, id: string): Promise<boolean> {
  return exists(api, locationPath(api, id));
}

/**
 * The ONE write of a location: PATCH its resource with `rev` and any subset of
 * its fields, `body` among them. Omitted, `rev` is read first — the helper
 * then plays the second writer.
 */
export async function patchLocation(
  api: Api,
  id: string,
  change: LocationChange & { rev?: number; force?: boolean },
): Promise<Location> {
  const rev = change.rev ?? (await getLocation(api, id)).rev;
  return api.send<Location>("PATCH", locationPath(api, id), { ...change, rev });
}
