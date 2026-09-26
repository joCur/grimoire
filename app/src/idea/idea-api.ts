// The API client of an idea (decisions/resources): its resource — list, create, tick off,
// put in the trash and take back out of it (decisions/trash).
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

/**
 * Put ONE idea in the trash against the `rev` it was read with. The answer is
 * the idea with its `deletedMs` and its moved `rev` — the guard its restore
 * sends back. A stale `rev` is 409 with the current idea; nothing is written.
 */
export function trashIdea(campaign: string, idea: Pick<Idea, "id" | "rev">): Promise<Idea> {
  return sendJson<Idea>("DELETE", ideasUrl(campaign, idea.id), { rev: idea.rev });
}

/** The ideas in the trash, the latest to go there first, each with its `deletedMs`. */
export function fetchTrashedIdeas(campaign: string): Promise<Idea[]> {
  return getJson<Idea[]>(`${ideasUrl(campaign)}?deleted=true`);
}

/**
 * Take ONE idea out of the trash against the `rev` it went there with; it
 * comes back at the place it had. A stale `rev` is 409 with the current idea.
 */
export function restoreIdea(campaign: string, idea: Pick<Idea, "id" | "rev">): Promise<Idea> {
  return sendJson<Idea>("PATCH", ideasUrl(campaign, idea.id), { rev: idea.rev, deletedMs: null });
}
