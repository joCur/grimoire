// An idea in the suite: its resource `…/ideas/:id` (decisions/resources), every field
// flat — `{ id, text, done, rev }`. Its type is the one
// `@grimoire/shared/idea` derives from the idea's schema.

import type { Idea } from "@grimoire/shared/idea";
import { underCampaign, type Api } from "./api";

/** The request path of one idea, or, without an id, of the idea list. */
export function ideaPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "ideas") : underCampaign(api, "ideas", id);
}

/** Every idea of the campaign, in the order it was thrown in. */
export function getIdeas(api: Api): Promise<Idea[]> {
  return api.get<Idea[]>(ideaPath(api));
}

/**
 * Put one idea in the trash (decisions/trash): DELETE its resource with the
 * `rev` it has now. Answers the idea with its `deletedMs` and moved `rev`.
 */
export async function trashIdea(api: Api, id: string): Promise<Idea> {
  const { rev } = await api.get<Idea>(ideaPath(api, id));
  return api.send<Idea>("DELETE", ideaPath(api, id), { rev });
}

/** The ideas in the trash, the latest to go there first. */
export function getTrashedIdeas(api: Api): Promise<Idea[]> {
  return api.get<Idea[]>(`${ideaPath(api)}?deleted=true`);
}
