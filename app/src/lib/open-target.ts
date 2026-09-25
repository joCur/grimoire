// What a link, an aside card, a `[[slug]]` reference or the live drawer
// opens, and the app route it lives at.
//
// Three kinds of target — a scene, an npc and a location, each its own
// resource with its own route (ADR #31). The target names which one it is,
// so nothing has to guess a route from an id; the route itself comes from the
// slice of the one it names.

import { locationHref } from "@/location/location-links";
import { npcHref } from "@/npc/npc-links";
import { sceneHref } from "@/scene/scene-links";

export type OpenTarget =
  | { kind: "scene"; id: string }
  | { kind: "npc"; id: string }
  | { kind: "location"; id: string };

/** The route a target opens at. */
export function openTargetHref(campaign: string, target: OpenTarget): string {
  switch (target.kind) {
    case "scene":
      return sceneHref(campaign, target.id);
    case "npc":
      return npcHref(campaign, target.id);
    case "location":
      return locationHref(campaign, target.id);
  }
}
