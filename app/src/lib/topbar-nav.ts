// Which section of the topbar's campaign navigation (chapters, NPCs,
// locations) the current view belongs to.
//
// The topbar chrome is global and STABLE: every campaign-scoped view shows the
// same left block, and the only thing that moves is this marking. So the
// question "where am I" has to be answerable from the route alone — no query,
// no waiting, no flicker between "unmarked" and "marked".
//
// Sections are the three campaign-wide entry points, not entity kinds: a scene
// entry belongs under Chapters because that is where the DM finds it, an NPC
// entry under NPCs no matter which chapter mentions it. Views that are not
// part of any section (generator, review, the campaign entry, a session, the
// glossary) are marked nowhere — an arbitrary highlight would be a lie.

import { kindFromAddress } from "@grimoire/shared/kind";

/** The three nav entries; `undefined` means "no entry is the current view". */
export type NavSection = "chapters" | "npcs" | "locations";

/** The view the topbar is rendering for, as far as the marking cares. */
export interface NavView {
  /** The chapter overview ("/campaigns/:campaign"). */
  isChapterOverview: boolean;
  /** `:kind` of "/campaigns/:campaign/list/:kind", or "" when this is not a list view. */
  listKind?: string;
  /** Campaign-relative path of "/campaigns/:campaign/entries/*", or "" when not an entry view. */
  entryPath?: string;
  /** A location's own routes: "/campaigns/:campaign/locations" and "…/locations/:id". */
  isLocations?: boolean;
}

/**
 * The section to mark, or undefined for the views that belong to none.
 *
 * The chapter overview and the scene list are Chapters; an entry's section comes from its
 * kind (the shared path table — the format contract in code exactly once):
 * scenes and chapters are Chapters, npc entries their list. A location's list
 * and reading view are Locations — their own routes (ADR #31).
 */
export function navSection(view: NavView): NavSection | undefined {
  if (view.isChapterOverview) return "chapters";
  if (view.isLocations === true) return "locations";

  switch (view.listKind) {
    case "scenes":
      return "chapters";
    case "npcs":
      return "npcs";
  }

  const path = view.entryPath ?? "";
  if (path === "") return undefined;
  switch (kindFromAddress(path)) {
    case "scene":
    case "chapter":
      return "chapters";
    case "npc":
      return "npcs";
    default:
      // The campaign entry and anything unknown — no section.
      return undefined;
  }
}
