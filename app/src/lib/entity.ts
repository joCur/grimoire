// Entity-kind helpers for the reading views.
//
// GET /entries/<address> answers with the entry's `kind`. The entry reading
// view picks its header from that kind — the scene header (type overline,
// chip row) must never sit above a chapter. Everything here is pure so it can
// be unit-tested without a DOM.

import type { EntityKind } from "@grimoire/shared/types";

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
