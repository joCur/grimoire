// Where an npc lives in the app and how it names itself (ADR #31): its
// reading view, its list, the context line of its reading view, and the label
// it carries beside the addresses of a run's scenes.

import type { ContextCrumb } from "@/components/PageContext";
import type { Translate } from "@/i18n";

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

/** The context of an npc's reading view: its list. */
export function npcPageCrumbs(campaign: string, t: Translate): ContextCrumb[] {
  if (campaign === "") return [];
  return [{ label: t("browse.title.npcs"), to: npcsHref(campaign) }];
}
