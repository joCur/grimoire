// The campaign in the suite: its resource `/campaigns/:campaign` (ADR #31),
// every field flat, `body` among them, beside its guard. Its type is the one
// `@grimoire/shared/campaign` derives from the campaign's schema.

import type { Campaign, CampaignChange } from "@grimoire/shared/campaign";
import { underCampaign, type Api } from "./api";

/** The request path of the bound campaign. */
export function campaignPath(api: Api): string {
  return underCampaign(api);
}

/** GET the bound campaign from its own resource; throws when it is unknown. */
export function getCampaign(api: Api): Promise<Campaign> {
  return api.get<Campaign>(campaignPath(api));
}

/**
 * The ONE write of the campaign: PATCH its resource with `rev` and any subset
 * of its fields, `body` among them. Omitted, `rev` is read first — the helper
 * then plays the second writer.
 */
export async function patchCampaign(
  api: Api,
  change: CampaignChange & { rev?: number; force?: boolean },
): Promise<Campaign> {
  const rev = change.rev ?? (await getCampaign(api)).rev;
  return api.send<Campaign>("PATCH", campaignPath(api), { ...change, rev });
}
