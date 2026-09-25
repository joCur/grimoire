// The query of a campaign: the key of the campaign itself — the text in the
// chapter overview's header and the edit dialog share it, so the campaign is
// not asked for twice. Its first segment is what the campaign's version poll
// invalidates. The campaign LIST is its own query (`["campaigns"]`).

import type { QueryKey } from "@tanstack/react-query";

import { fetchCampaign } from "./campaign-api";

const ONE = "campaign";

/** The first segment of every campaign query key. */
export const CAMPAIGN_QUERY_ROOTS = [ONE] as const;

/** The query key of the campaign. */
export function campaignKey(campaign: string): QueryKey {
  return [ONE, campaign];
}

/** Key and fetch of the campaign, for `useQuery` and `prefetchQuery` alike. */
export function campaignQuery(campaign: string) {
  return { queryKey: campaignKey(campaign), queryFn: () => fetchCampaign(campaign) };
}
