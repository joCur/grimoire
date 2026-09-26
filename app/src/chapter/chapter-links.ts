// Where a chapter lives in the app and how it names itself (decisions/resources): its
// reading view, the context line of that view, and the label it carries in a
// run's review beside the scenes, npcs and locations of the same run.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import type { ContextCrumb } from "@/components/PageContext";

/** The reading view of one chapter. */
export function chapterHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/chapters/${encodeURIComponent(id)}`;
}

/**
 * How a chapter names itself in a run's review beside the scenes, npcs and
 * locations of the same run: its resource segment and id, `chapters/<id>`.
 */
export function chapterLabel(id: string): string {
  return `chapters/${id}`;
}

/**
 * The context of a chapter's reading view: the chapter itself, linking to the
 * chapter overview where its scenes stand. The title comes from the tree, the
 * id stands in while the tree has none. The campaign name is never part of
 * it — the switcher carries it.
 */
export function chapterPageCrumbs(
  campaign: string,
  id: string,
  tree: CampaignTree | undefined,
): ContextCrumb[] {
  if (campaign === "" || id === "") return [];
  const title = tree?.chapters.find((chapter) => chapter.id === id)?.title ?? id;
  return [{ label: title, to: `/campaigns/${campaign}` }];
}
