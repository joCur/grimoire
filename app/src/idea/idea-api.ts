// The API client of an idea (decisions/resources): its resource — list, create, tick off.
// Built from the shared HTTP helpers (../api.ts).

import type { Idea } from "@grimoire/shared/idea";

import { campaignPath, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's ideas, or of one of them. */
function ideasUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/ideas`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** Every idea of the campaign, in the order it was thrown in, done or not. */
export function fetchIdeas(campaign: string): Promise<Idea[]> {
  return getJson<Idea[]>(ideasUrl(campaign));
}

/** Throw one idea in — the mobile capture. A new idea is open. */
export function createIdea(campaign: string, text: string): Promise<Idea> {
  return postJson<Idea>(ideasUrl(campaign), { text });
}

/**
 * Tick ONE idea off against the `rev` it was read with. A stale `rev` is 409
 * with the current idea; nothing is written.
 */
export function tickIdea(campaign: string, idea: Pick<Idea, "id" | "rev">): Promise<Idea> {
  return sendJson<Idea>("PATCH", ideasUrl(campaign, idea.id), { rev: idea.rev, done: true });
}
