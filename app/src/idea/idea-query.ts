// The query of the campaign's ideas — the review, the topbar's progress and
// the live aside read the same key, so an idea thrown in on the phone or ticked
// off in one of them is what the others show. Its first segment is what the
// campaign's version poll invalidates.
//
// A write answers the one idea it wrote, and the cached list takes it in
// place (`withIdea`) — the list is never read again for a row the server just
// handed over.

import type { Idea } from "@grimoire/shared/idea";
import type { QueryKey } from "@tanstack/react-query";

import { fetchIdeas } from "./idea-api";

const LIST = "ideas";

/** The first segment of every idea query key. */
export const IDEA_QUERY_ROOTS = [LIST] as const;

/** The query key of the campaign's ideas. */
export function ideasKey(campaign: string): QueryKey {
  return [LIST, campaign];
}

/** Key and fetch of the campaign's ideas. */
export function ideasQuery(campaign: string) {
  return { queryKey: ideasKey(campaign), queryFn: () => fetchIdeas(campaign) };
}

/** The list with this idea in it: in its place when it is there, else at the end. */
export function withIdea(list: readonly Idea[] | undefined, idea: Idea): Idea[] {
  const rows = list ?? [];
  return rows.some((row) => row.id === idea.id)
    ? rows.map((row) => (row.id === idea.id ? idea : row))
    : [...rows, idea];
}
