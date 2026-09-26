// The search (`GET /api/campaigns/:c/search`): the one truly mixed answer,
// so every hit names its entity by `kind` and `id` (decisions/resources).

/**
 * What a search hit names, by `kind` and `id` (see SearchResult).
 */
export type SearchKind =
  | "campaign"
  | "chapter"
  | "scene"
  | "npc"
  | "location"
  | "session"
  | "glossary-term";

/**
 * One row of GET /api/:campaign/search (the response wraps them as
 * `{ results: SearchResult[] }`, see SearchResponse). Indexed are the
 * campaign, the chapters, the scenes, the npcs, the locations and the
 * glossary terms — see server/src/store/fts.ts. The search is truly mixed, so
 * a hit names its entity by `kind` and `id`, and the app opens the resource
 * of that entity — or, for a glossary term, the glossary page, where the
 * terms are kept (decisions/resources).
 */
export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  /** Fuse.js score: 0 is a perfect match, values grow toward 1. */
  score: number;
  /** ~120 chars of body context around the first literal query hit. */
  snippet?: string;
}

/** GET /api/:campaign/search?q=… (400 on missing/empty q) */
export interface SearchResponse {
  results: SearchResult[];
}
