// The short forms of an entry — what the aside cards and the hover preview of
// a `[[slug]]` reference show of an NPC, a location or a scene.
//
// One reading for all of them, so a card and a preview never disagree: the
// same fields, the same section lookup (`firstParagraphOfSection`) and the
// same rule for references INSIDE an excerpt — they read as the current
// display name, plain text (an excerpt is no place for a second link). An
// unresolved slug keeps its brackets, exactly as the rendered text shows it,
// and a reference inside code stays code.
//
// Pure on purpose: the name lookup is passed in, so these run without a tree,
// a query or a DOM.

import { expandBodyEntityRefs } from "@grimoire/shared/refs";
import type { NpcStatus, SceneStatus } from "@grimoire/shared/types";

import { npcStatusOf } from "@/lib/entity";
import { firstParagraphOfSection } from "@/lib/md-section";
import { propQuickstats, propString } from "@/lib/properties";
import { sceneStatusOf } from "@/lib/scene-status";

/** What an entry is, as far as its short form cares. */
export interface ExcerptSource {
  properties: Record<string, unknown>;
  body: string;
}

/** Current display name of a slug, or undefined when nothing owns it. */
export type NameOf = (slug: string) => string | undefined;

export interface NpcExcerpt {
  role?: string;
  voice?: string;
  /** First paragraph of `## Will`, references as names. */
  will?: string;
  quickstats: [string, string][];
  status?: NpcStatus;
}

export interface LocationExcerpt {
  /** First paragraph of `## Atmosphäre`, references as names. */
  mood?: string;
  /** The Roll20 page reference — shown only where there is no mood line. */
  page?: string;
}

export interface SceneExcerpt {
  type?: string;
  trigger?: string;
  /** The location as the DM reads it: its display name, or the free text. */
  location?: string;
  status: SceneStatus;
}

/** A body section's first paragraph, with its references resolved. */
function sectionExcerpt(body: string, heading: string, nameOf: NameOf): string | undefined {
  const paragraph = firstParagraphOfSection(body, heading);
  return paragraph === undefined ? undefined : expandBodyEntityRefs(paragraph, nameOf);
}

export function npcExcerpt(entry: ExcerptSource, nameOf: NameOf): NpcExcerpt {
  const { properties } = entry;
  return {
    role: propString(properties.role),
    voice: propString(properties.voice),
    will: sectionExcerpt(entry.body, "Will", nameOf),
    quickstats: propQuickstats(properties.quickstats),
    status: npcStatusOf(properties),
  };
}

export function locationExcerpt(entry: ExcerptSource, nameOf: NameOf): LocationExcerpt {
  return {
    mood: sectionExcerpt(entry.body, "Atmosphäre", nameOf),
    page: propString(entry.properties["roll20-page"]),
  };
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
