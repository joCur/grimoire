// The short form of a scene — what the hover preview of a `[[slug]]`
// reference shows of it: its type, its trigger, its location and its status,
// read off its own fields (decisions/resources), never off a section of its text
// (decisions/data-shape).
//
// References INSIDE the trigger read as the current display name, plain text
// (a short form is no place for a second link). An unresolved slug keeps its
// brackets, exactly as the rendered text shows it, and a reference inside
// code stays code.
//
// Pure on purpose: the name lookups are passed in, so this runs without a
// tree, a query or a DOM.

import { expandBodyEntityRefs } from "@grimoire/shared/refs";
import type { SceneProposal, SceneStatus, SceneType } from "@grimoire/shared/scene";

/** Current display name of a slug, or undefined when nothing owns it. */
export type NameOf = (slug: string) => string | undefined;

export interface SceneExcerpt {
  type: SceneType;
  /** The `trigger` field, references as names. */
  trigger?: string;
  /** The location as the DM reads it: its display name, or its id as written. */
  location?: string;
  status: SceneStatus;
}

/**
 * `locationName` answers for a location id only — the scene's `location` is
 * a location, so the npc-first priority of `[[…]]` must not apply to it.
 */
export function sceneExcerpt(
  scene: Pick<SceneProposal, "type" | "trigger" | "location" | "status">,
  locationName: NameOf,
  nameOf: NameOf,
): SceneExcerpt {
  const { type, trigger, location, status } = scene;
  return {
    type,
    ...(trigger === undefined || trigger === ""
      ? {}
      : { trigger: expandBodyEntityRefs(trigger, nameOf) }),
    ...(location === undefined || location === ""
      ? {}
      : { location: locationName(location) ?? location }),
    status,
  };
}
