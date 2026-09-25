// What a link, an aside card, a `[[slug]]` reference or the live drawer
// opens, and the app route it lives at.
//
// Three kinds of target: a row reached through its ADDRESS (a scene, a
// chapter, the campaign — `/campaigns/:c/entries/<address>`), and an npc and a
// location, which are each their own resource with their own route (ADR #31).
// The target names which one it is, so nothing has to guess a route from an
// id; the route of an npc and of a location comes from its own slice.

import { encodeAddress } from "@/lib/address";
import { locationHref } from "@/location/location-links";
import { npcHref } from "@/npc/npc-links";

export type OpenTarget =
  | { kind: "entry"; path: string }
  | { kind: "npc"; id: string }
  | { kind: "location"; id: string };

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
