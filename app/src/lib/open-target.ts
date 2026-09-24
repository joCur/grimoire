// What a link, an aside card, a `[[slug]]` reference or the live drawer
// opens, and the app route it lives at.
//
// Two kinds of target: a row reached through its ADDRESS (a scene, an npc, a
// chapter, the campaign — `/campaigns/:c/entries/<address>`), and a location,
// which is its own resource with its own route (ADR #31,
// `/campaigns/:c/locations/:id`). The target names which one it is, so
// nothing has to guess a route from an id.

import { encodeAddress } from "@/lib/address";

export type OpenTarget = { kind: "entry"; path: string } | { kind: "location"; id: string };

/** The reading view of one location. */
export function locationHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/locations/${encodeURIComponent(id)}`;
}

/**
 * How a location names itself in a list beside the addresses of the other
 * kinds (a run's review and its written list): its resource segment and id,
 * `locations/<id>`, the way an npc shows as `npcs/<id>`.
 */
export function locationLabel(id: string): string {
  return `locations/${id}`;
}

/** The list of a campaign's locations. */
export function locationsHref(campaign: string): string {
  return `/campaigns/${campaign}/locations`;
}

/** The route a target opens at. */
export function openTargetHref(campaign: string, target: OpenTarget): string {
  return target.kind === "location"
    ? locationHref(campaign, target.id)
    : `/campaigns/${campaign}/entries/${encodeAddress(target.path)}`;
}
