// Where a scene lives in the app and how it names itself (decisions/resources): its
// reading view, the context line of that view, and the label it carries in a
// run's review beside the npcs and locations of the same run.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import type { ContextCrumb } from "@/components/PageContext";
import { locationName } from "@/lib/campaign";

/** The reading view of one scene. */
export function sceneHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/scenes/${encodeURIComponent(id)}`;
}

/**
 * How a scene names itself in a run's review and its written list, beside the
 * npcs and locations of the same run: its resource segment and id,
 * `scenes/<id>`.
 */
export function sceneLabel(id: string): string {
  return `scenes/${id}`;
}

/**
 * The context of a scene's reading view: `<chapter title> › <location>`, the
 * chapter linking to the chapter overview, where the scene stands in its
 * chapter's list. The location is its display name (the id as written when
 * the tree has no name for it) and is absent for a scene that names none.
 * The campaign name is never part of it — the switcher carries it.
 */
export function scenePageCrumbs(
  campaign: string,
  scene: { chapter: string; location?: string | undefined },
  tree: CampaignTree | undefined,
): ContextCrumb[] {
  if (campaign === "" || scene.chapter === "") return [];
  const chapter = tree?.chapters.find((candidate) => candidate.id === scene.chapter);
  const crumbs: ContextCrumb[] = [
    { label: chapter?.title ?? scene.chapter, to: `/campaigns/${campaign}` },
  ];
  const location = locationName(tree, scene.location);
  if (location !== undefined) crumbs.push({ label: location });
  return crumbs;
}
