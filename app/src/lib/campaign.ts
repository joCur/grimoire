// Small lookups against the campaign tree (display-name resolution).

import type { CampaignTree } from "@grimoire/shared/types";

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
