// Where a chapter lives in the app and how it names itself (decisions/resources): its
// reading view and the label it carries in a run's review beside the scenes,
// npcs and locations of the same run.

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
