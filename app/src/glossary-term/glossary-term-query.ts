// The query of a campaign's glossary terms — the glossary page and the
// generator's context line read the same key, so a term saved on one shows up
// on the other. Its first segment is what the campaign's version poll
// invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchGlossaryTerms } from "./glossary-term-api";

const LIST = "glossary-terms";

/** The first segment of every glossary-term query key. */
export const GLOSSARY_TERM_QUERY_ROOTS = [LIST] as const;

/** The query key of the campaign's glossary terms. */
export function glossaryTermsKey(campaign: string): QueryKey {
  return [LIST, campaign];
}

/** Key and fetch of the campaign's glossary terms. */
export function glossaryTermsQuery(campaign: string) {
  return { queryKey: glossaryTermsKey(campaign), queryFn: () => fetchGlossaryTerms(campaign) };
}
