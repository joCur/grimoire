// Small lookups against the campaign tree (display-name resolution) and the
// campaign list (which campaign "/" opens).

import { compareSessionIdsNewestFirst } from "@grimoire/shared/session-id";
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
 * A session id is NOT comparable as a string since issue #58: a day can hold
 * several sessions (`2026-09-06`, `-2`, … `-10`), and `…-10` is the newest but
 * the smallest string. The comparison therefore goes through the shared
 * `compareSessionIdsNewestFirst` (date part, then NUMERIC sequence), the same
 * rule the server sorts its session list by. A missing or empty `lastSession`
 * is "no session at all" and sorts behind every campaign that has one.
 */
function byLastActive(a: CampaignSummary, b: CampaignSummary): number {
  const sessionA = typeof a.lastSession === "string" ? a.lastSession.trim() : "";
  const sessionB = typeof b.lastSession === "string" ? b.lastSession.trim() : "";
  if (sessionA === "" !== (sessionB === "")) return sessionA === "" ? 1 : -1;
  if (sessionA !== "" && sessionA !== sessionB) {
    return compareSessionIdsNewestFirst(sessionA, sessionB);
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
