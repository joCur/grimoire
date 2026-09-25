// Where a location lives in the app and how it names itself (ADR #31): its
// reading view, its list, the context line of its reading view, and the label
// it carries beside the addresses of a run's scenes.

import type { ContextCrumb } from "@/components/PageContext";
import type { Translate } from "@/i18n";

/** The reading view of one location. */
export function locationHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/locations/${encodeURIComponent(id)}`;
}

/** The list of a campaign's locations. */
export function locationsHref(campaign: string): string {
  return `/campaigns/${campaign}/locations`;
}

/**
 * How a location names itself in a list beside the addresses of a run's
 * scenes (a run's review and its written list): its resource segment and id,
 * `locations/<id>`.
 */
export function locationLabel(id: string): string {
  return `locations/${id}`;
}

/** The context of a location's reading view: its list. */
export function locationPageCrumbs(campaign: string, t: Translate): ContextCrumb[] {
  if (campaign === "") return [];
  return [{ label: t("browse.title.locations"), to: locationsHref(campaign) }];
}
