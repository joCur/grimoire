// The short form of a scene — what the hover preview of a `[[slug]]`
// reference shows of it: its type, its trigger, its location and its status.
//
// References INSIDE the trigger read as the current display name, plain text
// (a short form is no place for a second link). An unresolved slug keeps its
// brackets, exactly as the rendered text shows it, and a reference inside
// code stays code.
//
// Pure on purpose: the name lookup is passed in, so this runs without a tree,
// a query or a DOM.

import { expandBodyEntityRefs } from "@grimoire/shared/refs";
import type { SceneStatus } from "@grimoire/shared/types";

import { propString } from "@/lib/properties";
import { sceneStatusOf } from "@/lib/scene-status";

/**
 * What a scene is, as far as its short form cares: its properties. The body
 * is not read — nothing a card shows is derived from the text.
 */
export interface ExcerptSource {
  properties: Record<string, unknown>;
}

/** Current display name of a slug, or undefined when nothing owns it. */
export type NameOf = (slug: string) => string | undefined;

export interface SceneExcerpt {
  type?: string;
  trigger?: string;
  /** The location as the DM reads it: its display name, or the free text. */
  location?: string;
  status: SceneStatus;
}

/**
 * `locationName` answers for a location id only — the scene's `location` is
 * a location, so the npc-first priority of `[[…]]` must not apply to it.
 */
export function sceneExcerpt(
  entry: ExcerptSource,
  locationName: NameOf,
  nameOf: NameOf,
): SceneExcerpt {
  const { properties } = entry;
  const trigger = propString(properties.trigger);
  const location = propString(properties.location);
  return {
    type: propString(properties.type),
    trigger: trigger === undefined ? undefined : expandBodyEntityRefs(trigger, nameOf),
    location: location === undefined ? undefined : (locationName(location) ?? location),
    status: sceneStatusOf(properties),
  };
}
