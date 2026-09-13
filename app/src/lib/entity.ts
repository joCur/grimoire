// Entity-kind helpers for the file reading view (issue #26).
//
// GET /file answers with the entity `kind` (path-derived, see
// shared/src/parse.ts). The reading view picks its header from that kind —
// the scene header (type overline, chip row) must never sit above an NPC or
// a location. Everything here is pure so it can be unit-tested without a DOM.

import type { EntityKind } from "@grimoire/shared/types";

import type { MessageKey, Translate } from "@/i18n";

/**
 * Which header the reading view renders for a kind:
 *
 *   scene              -> the scene article (type overline, trigger, chips)
 *   npc / location     -> their own entity headers
 *   everything else    -> title + body (chapter, campaign, session, inbox,
 *                         glossary, unknown) — quiet and generic, never the
 *                         scene overline.
 */
export type EntityHeaderKind = "scene" | "npc" | "location" | "titled";

export function entityHeaderKind(kind: EntityKind): EntityHeaderKind {
  switch (kind) {
    case "scene":
      return "scene";
    case "npc":
      return "npc";
    case "location":
      return "location";
    default:
      return "titled";
  }
}

/**
 * Entity ids are kebab slugs. The rule itself lives in `@grimoire/shared/slug`
 * since issue #56 — server and app derive the SAME id from a typed title, so
 * the regex and the transliteration cannot be two copies any more. Re-exported
 * here because this is where the app's callers look for it: the properties form
 * (does an unknown value become an entry or stay free text?), its `npcs` list
 * (is this an id at all?) and the review's #npc lines.
 */
export { isEntityId } from "@grimoire/shared/slug";

/**
 * Labels for the known npc `status` values (shared NPC_STATUSES), from the
 * catalog since issue #69 — the translator is PASSED IN, so this module holds
 * no copy of its own (i18n/index.ts, the lib-layer rule).
 *
 * The format degrades: an unknown value is shown verbatim instead of being
 * swallowed or corrected — the file stays the truth.
 */
const NPC_STATUS_KEYS: Record<string, MessageKey> = {
  alive: "status.npc.alive",
  dead: "status.npc.dead",
  missing: "status.npc.missing",
  unknown: "status.npc.unknown",
};

export function npcStatusLabel(status: string, t: Translate): string {
  const trimmed = status.trim();
  const key = NPC_STATUS_KEYS[trimmed.toLowerCase()];
  return key === undefined ? trimmed : t(key);
}

/**
 * Title of a browse list page ("/:campaign/list/:kind"), or undefined for a
 * kind that has no list. Shared by the list page itself and the topbar
 * breadcrumb — on the desktop those pages are reached from the pool now
 * (issue #26), so they need a way back.
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
