// Display metadata of the current campaign (issue #17): the `name` and
// `description` from its optional `_campaign`, served additively by
// GET /api/campaigns.
//
// Every surface that shows a campaign label (topbar switcher + breadcrumbs,
// pool header, mobile start surface) reads it from here. The query key is the
// same one the switcher and the "/" redirect already use, so this shares the
// TanStack Query cache — no extra request per surface.

import { useQuery } from "@tanstack/react-query";

import { fetchCampaigns } from "@/api";
import { campaignDescription, campaignLabel, findCampaign } from "@/lib/campaign";

export interface CampaignMeta {
  /** Display name; falls back to the id (URLs always keep the id). */
  label: string;
  /** One-liner from the file, or undefined. */
  description: string | undefined;
}

export function useCampaignMeta(campaign: string): CampaignMeta {
  const { data } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
    enabled: campaign !== "",
  });
  const entry = findCampaign(data, campaign);
  return { label: campaignLabel(entry, campaign), description: campaignDescription(entry) };
}
