// Where a glossary term lives in the app (decisions/resources): on the glossary page,
// among the other terms — a term has no page of its own.

/** The glossary page, where every term of the campaign is kept. */
export function glossaryHref(campaign: string): string {
  return `/campaigns/${campaign}/glossary`;
}
