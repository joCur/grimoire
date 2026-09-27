// Where an npc lives in the app and how it names itself (decisions/resources): its
// reading view, its list, and the label
// it carries beside the addresses of a run's scenes.

/** The reading view of one npc. */
export function npcHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/npcs/${encodeURIComponent(id)}`;
}

/** The list of a campaign's npcs. */
export function npcsHref(campaign: string): string {
  return `/campaigns/${campaign}/npcs`;
}

/**
 * How an npc names itself in a list beside the addresses of a run's scenes
 * (a run's review and its written list): its resource segment and id,
 * `npcs/<id>`.
 */
export function npcLabel(id: string): string {
  return `npcs/${id}`;
}
