// Small lookups against the campaign tree (display-name resolution) and the
// campaign list (which campaign "/" opens).

import type { CampaignSummary, CampaignTree } from "@grimoire/shared/types";

import { parseLocalDateTime } from "@/lib/session";

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
 * Resolve a scene id to its title via the tree (issue #34: the review's
 * source chip names the scene, not its id). Unknown ids pass through
 * unchanged — the id is the honest fallback, never a prettified guess.
 */
export function sceneTitle(
  tree: CampaignTree | undefined,
  sceneId: string | undefined,
): string | undefined {
  if (sceneId === undefined) return undefined;
  for (const chapter of tree?.chapters ?? []) {
    for (const group of chapter.groups) {
      const scene = group.scenes.find((s) => s.id === sceneId);
      if (scene !== undefined) return scene.title;
    }
  }
  return sceneId;
}

/**
 * The campaign's display label: the `name` from its optional `_campaign.md`
 * (issue #17), else the id — which is the directory name and stays the key in
 * every URL. Never returns an empty string.
 */
export function campaignLabel(campaign: CampaignSummary | undefined, id: string): string {
  const name = campaign?.name;
  return typeof name === "string" && name.trim() !== "" ? name : id;
}

/** The campaign's one-line description, or undefined when it has none. */
export function campaignDescription(campaign: CampaignSummary | undefined): string | undefined {
  const description = campaign?.description;
  return typeof description === "string" && description.trim() !== "" ? description : undefined;
}

/** The list entry for one campaign id (the /campaigns response is cached). */
export function findCampaign(
  campaigns: CampaignSummary[] | undefined,
  id: string,
): CampaignSummary | undefined {
  return campaigns?.find((c) => c.id === id);
}

/**
 * Order of the campaign list for "last active first" (issue #14): the
 * campaign with the newest session wins, campaigns without a session rank
 * behind all that have one, and ties fall back to the alphabetically first
 * id.
 *
 * A session ID says NOTHING about time since the PO decision on issue #58 —
 * it is an opaque random string, so sorting by it would sort noise. The order
 * therefore reads `lastSessionStarted`, the newest session's `started` as the
 * server computed it (CampaignSummary), and compares the two as timestamps.
 * A missing, empty or unparsable value is "no session at all" and sorts behind
 * every campaign that has one; ties fall back to the id.
 */
function startedMs(campaign: CampaignSummary): number | undefined {
  return parseLocalDateTime(campaign.lastSessionStarted);
}

function byLastActive(a: CampaignSummary, b: CampaignSummary): number {
  const ma = startedMs(a);
  const mb = startedMs(b);
  if (ma === undefined || mb === undefined) {
    if (ma !== mb) return ma === undefined ? 1 : -1;
  } else if (ma !== mb) {
    return mb - ma;
  }
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
