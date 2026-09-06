// Which section of the topbar's campaign navigation ("Kapitel · NPCs · Orte")
// the current view belongs to (issue #34, PO rework of PR #35).
//
// The topbar chrome is global and STABLE: every campaign-scoped view shows the
// same left block, and the only thing that moves is this marking. So the
// question "where am I" has to be answerable from the route alone — no query,
// no waiting, no flicker between "unmarked" and "marked".
//
// Sections are the three campaign-wide entry points, not entity kinds: a scene
// file belongs under Kapitel because that is where the DM finds it, an NPC file
// under NPCs no matter which chapter mentions it. Views that are not part of
// any section (generator, review, the campaign file, sessions, inbox, glossary)
// are marked nowhere — an arbitrary highlight would be a lie.

import { kindFromPath } from "@grimoire/shared/kind";

/** The three nav entries; `undefined` means "no entry is the current view". */
export type NavSection = "chapters" | "npcs" | "locations";

/** The view the topbar is rendering for, as far as the marking cares. */
export interface NavView {
  /** The pool ("/:campaign"). */
  isPool: boolean;
  /** `:kind` of "/:campaign/list/:kind", or "" when this is not a list view. */
  listKind?: string;
  /** Campaign-relative path of "/:campaign/file/*", or "" when not a file view. */
  filePath?: string;
}

/**
 * The section to mark, or undefined for the views that belong to none.
 *
 * The pool and the scene list are Kapitel; a file's section comes from its
 * kind (the shared path table — the format contract in code exactly once):
 * scenes and `_chapter` are Kapitel, npc/location files their own lists.
 */
export function navSection(view: NavView): NavSection | undefined {
  if (view.isPool) return "chapters";

  switch (view.listKind) {
    case "scenes":
      return "chapters";
    case "npcs":
      return "npcs";
    case "locations":
      return "locations";
  }

  const path = view.filePath ?? "";
  if (path === "") return undefined;
  switch (kindFromPath(path)) {
    case "scene":
    case "chapter":
      return "chapters";
    case "npc":
      return "npcs";
    case "location":
      return "locations";
    default:
      // campaign file, session, inbox, glossary, unknown — no section.
      return undefined;
  }
}
