// A glossary term in the suite: its resource `…/glossary-terms/:id`
// (decisions/resources), every field flat — `{ id, term, explanation, rev }`. Its type is
// the one `@grimoire/shared/glossary-term` derives from the term's schema.

import type {
  GlossaryTerm,
  GlossaryTermChange,
  GlossaryTermCreate,
} from "@grimoire/shared/glossary-term";
import { underCampaign, type Api } from "./api";

/** The request path of one term, or, without an id, of the term list. */
export function glossaryTermPath(api: Api, id?: string): string {
  return id === undefined
    ? underCampaign(api, "glossary-terms")
    : underCampaign(api, "glossary-terms", id);
}

/** Every term of the campaign, in the order it was created. */
export function getGlossaryTerms(api: Api): Promise<GlossaryTerm[]> {
  return api.get<GlossaryTerm[]>(glossaryTermPath(api));
}

/** GET one term from its own resource; throws when it is unknown. */
export function getGlossaryTerm(api: Api, id: string): Promise<GlossaryTerm> {
  return api.get<GlossaryTerm>(glossaryTermPath(api, id));
}

/** A new term — the write the glossary page's add action makes. */
export function createGlossaryTerm(api: Api, input: GlossaryTermCreate): Promise<GlossaryTerm> {
  return api.send<GlossaryTerm>("POST", glossaryTermPath(api), input);
}

/**
 * The ONE write of a term: PATCH its resource with `rev` and any subset of
 * its fields. Omitted, `rev` is read first — the helper then plays the second
 * writer.
 */
export async function patchGlossaryTerm(
  api: Api,
  id: string,
  change: GlossaryTermChange & { rev?: number },
): Promise<GlossaryTerm> {
  const rev = change.rev ?? (await getGlossaryTerm(api, id)).rev;
  return api.send<GlossaryTerm>("PATCH", glossaryTermPath(api, id), { ...change, rev });
}

/** Delete one term against its current `rev` — a second writer's delete. */
export async function deleteGlossaryTerm(api: Api, id: string): Promise<void> {
  const { rev } = await getGlossaryTerm(api, id);
  const res = await api.fetch(glossaryTermPath(api, id), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev }),
  });
  if (res.status !== 204) throw new Error(`DELETE term ${id}: HTTP ${res.status}`);
}
