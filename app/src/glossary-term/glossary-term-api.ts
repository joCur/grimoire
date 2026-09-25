// The API client of a glossary term (ADR #31): its resource — list, create,
// write, delete. Built from the shared HTTP helpers (../api.ts).

import type {
  GlossaryTerm,
  GlossaryTermChange,
  GlossaryTermCreate,
} from "@grimoire/shared/glossary-term";

import { campaignPath, deleteJson, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's glossary terms, or of one of them. */
function termsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/glossary-terms`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** Every term of the campaign, in the order it was created. */
export function fetchGlossaryTerms(campaign: string): Promise<GlossaryTerm[]> {
  return getJson<GlossaryTerm[]>(termsUrl(campaign));
}

/**
 * A new term. No `rev`: a new term overwrites nothing. A term the glossary
 * already has is 409 `glossary_term_taken` and writes nothing.
 */
export function createGlossaryTerm(campaign: string, input: GlossaryTermCreate): Promise<GlossaryTerm> {
  return postJson<GlossaryTerm>(termsUrl(campaign), input);
}

/**
 * Write ONE term against the `rev` it was read with — or, with `force`, on
 * top of the stored one. A stale `rev` is 409 with the current term.
 */
export function patchGlossaryTerm(
  campaign: string,
  id: string,
  rev: number,
  change: GlossaryTermChange,
  force = false,
): Promise<GlossaryTerm> {
  return sendJson<GlossaryTerm>("PATCH", termsUrl(campaign, id), {
    ...change,
    rev,
    ...(force ? { force } : {}),
  });
}

/** Delete ONE term against the `rev` it was read with; same 409 as the patch. */
export function deleteGlossaryTerm(campaign: string, id: string, rev: number): Promise<void> {
  return deleteJson(termsUrl(campaign, id), { rev });
}
