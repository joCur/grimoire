// What a link, an aside card, a `[[slug]]` reference or the live drawer
// opens, and the app route it lives at.
//
// Three kinds of target: a row reached through its ADDRESS (a scene, a
// chapter, the campaign — `/campaigns/:c/entries/<address>`), and an npc and a
// location, which are each their own resource with their own route (ADR #31,
// `/campaigns/:c/npcs/:id` and `/campaigns/:c/locations/:id`). The target
// names which one it is, so nothing has to guess a route from an id.

import { encodeAddress } from "@/lib/address";

export type OpenTarget =
  | { kind: "entry"; path: string }
  | { kind: "npc"; id: string }
  | { kind: "location"; id: string };

/** The reading view of one npc. */
export function npcHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/npcs/${encodeURIComponent(id)}`;
}

/**
 * How an npc names itself in a list beside the addresses of a run's scenes
 * (a run's review and its written list): its resource segment and id,
 * `npcs/<id>`.
 */
export function npcLabel(id: string): string {
  return `npcs/${id}`;
}

/** The list of a campaign's npcs. */
export function npcsHref(campaign: string): string {
  return `/campaigns/${campaign}/npcs`;
}

/** The reading view of one location. */
export function locationHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/locations/${encodeURIComponent(id)}`;
}

/**
 * How a location names itself in a list beside the addresses of a run's
 * scenes (a run's review and its written list): its resource segment and id,
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
  switch (target.kind) {
    case "npc":
      return npcHref(campaign, target.id);
    case "location":
      return locationHref(campaign, target.id);
    case "entry":
      return `/campaigns/${campaign}/entries/${encodeAddress(target.path)}`;
  }
}
