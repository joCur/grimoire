// Which section of the topbar's campaign navigation (chapters, NPCs,
// locations) the current view belongs to.
//
// The topbar chrome is global and STABLE: every campaign-scoped view shows the
// same left block, and the only thing that moves is this marking. So the
// question "where am I" has to be answerable from the route alone — no query,
// no waiting, no flicker between "unmarked" and "marked".
//
// Sections are the three campaign-wide entry points, not entity kinds: a
// chapter and a scene belong under Chapters because that is where the DM finds
// them, an npc under NPCs no matter which chapter mentions it. Views that are
// not part of any section (generator, review, a session, the glossary) are
// marked nowhere — an arbitrary highlight would be a lie.

/** The three nav entries; `undefined` means "no entry is the current view". */
export type NavSection = "chapters" | "npcs" | "locations";

/** The view the topbar is rendering for, as far as the marking cares. */
export interface NavView {
  /** The chapter overview ("/campaigns/:campaign"). */
  isChapterOverview: boolean;
  /** `:kind` of "/campaigns/:campaign/list/:kind", or "" when this is not a list view. */
  listKind?: string;
  /** A chapter's reading view: "/campaigns/:campaign/chapters/:id". */
  isChapter?: boolean;
  /** A scene's reading view: "/campaigns/:campaign/scenes/:id". */
  isScene?: boolean;
  /** An npc's own routes: "/campaigns/:campaign/npcs" and "…/npcs/:id". */
  isNpcs?: boolean;
  /** A location's own routes: "/campaigns/:campaign/locations" and "…/locations/:id". */
  isLocations?: boolean;
}

/**
 * The section to mark, or undefined for the views that belong to none.
 *
 * The chapter overview, the scene list and the reading views of a chapter and
 * a scene are Chapters. An npc's and a location's list and reading view are
 * NPCs and Locations — each its own route (ADR #31).
 */
export function navSection(view: NavView): NavSection | undefined {
  if (view.isChapterOverview || view.isChapter === true || view.isScene === true) {
    return "chapters";
  }
  if (view.isNpcs === true) return "npcs";
  if (view.isLocations === true) return "locations";
  if (view.listKind === "scenes") return "chapters";
  return undefined;
}
