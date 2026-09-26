// Where a campaign lives in the app (decisions/resources): its route is the chapter
// overview, the page every campaign opens on.

/** The campaign's own route — the chapter overview. */
export function campaignHref(campaign: string): string {
  return `/campaigns/${encodeURIComponent(campaign)}`;
}
