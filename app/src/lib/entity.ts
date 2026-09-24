// Entity-kind helpers for the entry reading view.
//
// GET /entries/<address> answers with the entry's `kind`. The reading view
// picks its header from that kind — the scene header (type overline, chip
// row) must never sit above an NPC. Everything here is pure so it can be unit-tested without a DOM.

import type { EntityKind, NpcStatus } from "@grimoire/shared/types";

import type { MessageKey, Translate } from "@/i18n";
import { propString } from "@/lib/properties";

/**
 * Which header the entry reading view renders for a kind:
 *
 *   scene              -> the scene article (type overline, trigger, chips)
 *   npc                -> its own entity header
 *   everything else    -> title + body (chapter, campaign, unknown) — quiet
 *                         and generic, never the scene overline.
 *
 * A location is read on its own route (ADR #31), not through this switch.
 */
export type EntityHeaderKind = "scene" | "npc" | "titled";

export function entityHeaderKind(kind: EntityKind): EntityHeaderKind {
  switch (kind) {
    case "scene":
      return "scene";
    case "npc":
      return "npc";
    default:
      return "titled";
  }
}

/**
 * Entity ids are kebab slugs. The rule itself lives in `@grimoire/shared/slug`
 * — server and app derive the SAME id from a typed title, so the regex and the
 * transliteration are not two copies. Re-exported here because this is where
 * the app's callers look for it: the properties form
 * (does an unknown value become an entry or stay free text?), its `npcs` list
 * (is this an id at all?) and the review's #npc rows.
 */
export { isEntityId } from "@grimoire/shared/slug";

/**
 * Labels for the npc `status` values (shared NPC_STATUSES), from the
 * catalog — the translator is PASSED IN, so this module holds no copy of its
 * own (i18n/index.ts, the lib-layer rule).
 *
 * `unknown` is one of the four stored values — the NPC nobody has placed yet —
 * and not a fallback: `npcs.status` is a CHECK constraint of its column, so
 * the database cannot hold anything else (ADR #25).
 */
const NPC_STATUS_KEYS: Record<NpcStatus, MessageKey> = {
  alive: "status.npc.alive",
  dead: "status.npc.dead",
  missing: "status.npc.missing",
  unknown: "status.npc.unknown",
};

export function npcStatusLabel(status: NpcStatus, t: Translate): string {
  return t(NPC_STATUS_KEYS[status]);
}

/**
 * The status of an npc entry, read out of its untyped `properties` bag —
 * undefined when the entry carries none, which is what leaves the pill off.
 */
export function npcStatusOf(properties: Record<string, unknown>): NpcStatus | undefined {
  return propString(properties.status) as NpcStatus | undefined;
}

/**
 * Title of a browse list page ("/campaigns/:campaign/list/:kind"), or undefined for a
 * kind that has no list. Shared by the list page itself and the topbar
 * breadcrumb — on the desktop those pages are reached from the chapter overview, so they
 * need a way back.
 */
const BROWSE_LIST_TITLE_KEYS: Record<string, MessageKey> = {
  scenes: "browse.title.scenes",
  npcs: "browse.title.npcs",
  locations: "browse.title.locations",
};

export function browseListTitle(kind: string, t: Translate): string | undefined {
  const key = BROWSE_LIST_TITLE_KEYS[kind];
  return key === undefined ? undefined : t(key);
}
