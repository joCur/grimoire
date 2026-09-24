// Entity-kind helpers for the reading views.
//
// GET /entries/<address> answers with the entry's `kind`. The entry reading
// view picks its header from that kind — the scene header (type overline,
// chip row) must never sit above a chapter. Everything here is pure so it can
// be unit-tested without a DOM.

import type { EntityKind, NpcStatus } from "@grimoire/shared/types";

import type { MessageKey, Translate } from "@/i18n";

/**
 * Which header the entry reading view renders for a kind:
 *
 *   scene              -> the scene article (type overline, trigger, chips)
 *   everything else    -> title + body (chapter, campaign, unknown) — quiet
 *                         and generic, never the scene overline.
 *
 * An npc and a location are each read on their own route (ADR #31), not
 * through this switch.
 */
export type EntityHeaderKind = "scene" | "titled";

export function entityHeaderKind(kind: EntityKind): EntityHeaderKind {
  return kind === "scene" ? "scene" : "titled";
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
 * Title of a browse list page — the scene list (`/campaigns/:campaign/list/scenes`)
 * and the npc and location lists on their own routes — or undefined for a
 * kind that has no list.
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
