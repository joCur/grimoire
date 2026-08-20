// Small lookups against the campaign tree (display-name resolution) and the
// campaign list (which campaign "/" opens).

import type { CampaignSummary, CampaignTree } from "@grimoire/shared/types";

/**
 * Resolve a location id to its display name via the tree; free strings
 * and unknown ids pass through unchanged (degrade).
 */
export function locationName(
  tree: CampaignTree | undefined,
  location: string | undefined,
): string | undefined {
  if (location === undefined) return undefined;
  return tree?.locations.find((l) => l.id === location)?.name ?? location;
}

/**
 * Order of the campaign list for "last active first" (issue #14): the
 * campaign with the newest session wins, campaigns without a session rank
 * behind all that have one, and ties fall back to the alphabetically first
 * id. Session ids are dates (`yyyy-mm-dd`), so plain string compare is date
 * compare; a missing (or empty) `lastSession` is the smallest value and thus
 * sorts last.
 */
function byLastActive(a: CampaignSummary, b: CampaignSummary): number {
  const sessionA = typeof a.lastSession === "string" ? a.lastSession : "";
  const sessionB = typeof b.lastSession === "string" ? b.lastSession : "";
  if (sessionA !== sessionB) return sessionA > sessionB ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The campaign "/" redirects into: the last active one per byLastActive.
 * undefined only when the list is empty (then "/" shows the empty state).
 * With exactly one campaign it is always that one.
 */
export function pickLastCampaign(campaigns: CampaignSummary[]): string | undefined {
  let best: CampaignSummary | undefined;
  for (const campaign of campaigns) {
    if (best === undefined || byLastActive(campaign, best) < 0) best = campaign;
  }
  return best?.id;
}
