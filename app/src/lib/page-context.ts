// The context line of a reading view: where the row on screen sits.
//
// The context line sits inside the page, next to the title it describes,
// rather than in the global chrome. Two rules follow:
//
//   1. The campaign name is NOT part of it. It appears exactly once in the
//      whole chrome, in the switcher; repeating it here reads as noise ("Der
//      Leuchtturm von Salzhafen / Kapitel 1: Der Leuchtturm von Salzhafen /
//      Fenn").
//   2. The context is the path the DM actually took, so an npc or a location
//      view points at ITS list — not at some chapter that happens to mention
//      it, which is misleading for an npc opened from the npc list.
//
// A scene's, an npc's and a location's reading views name their context in
// their own slices; what is left here is the step type and the context of
// what is read by its address (a chapter, the campaign).

import type { CampaignTree } from "@grimoire/shared/types";
import { kindFromAddress } from "@grimoire/shared/kind";

/** One step of the context line; without `to` it is plain text. */
export interface ContextCrumb {
  label: string;
  to?: string;
}

/**
 * Context crumbs for the reading view of an address. A chapter is just the
 * chapter, linking to the chapter overview where its scenes live; the campaign
 * and any address the schema does not describe get no line — the nav's
 * section marking is context enough there.
 */
export function pageContextCrumbs(
  campaign: string,
  path: string,
  tree: CampaignTree | undefined,
): ContextCrumb[] {
  if (campaign === "" || kindFromAddress(path) !== "chapter") return [];
  const title = tree?.chapters.find((chapter) => chapter.id === path)?.title ?? path;
  return [{ label: title, to: `/campaigns/${campaign}` }];
}
