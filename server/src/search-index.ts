// In-memory search index per campaign (issue #7) and per-campaign version
// counters (issue #8).
//
// INDEX: built lazily on the first search for a campaign, cached until
// invalidateCampaign() drops it (called by the chokidar watcher — and by
// tests directly, so they never depend on watcher timing). Fuse.js over a
// few hundred files needs no persistent index (DECISIONS #5; growth path:
// SQLite, DECISIONS #7).
//
// VERSION COUNTER: the cheapest client-refresh mechanism. The watcher bumps
// it on any markdown change; the app polls GET /api/:campaign/version and
// invalidates its queries when the value changes. SSE was considered and
// deferred — polling suffices for a single user, and SSE can be added later
// without breaking this API (DECISIONS #9).

import Fuse, { type IFuseOptions } from "fuse.js";
import type { EntityKind, ParsedFile, SearchResult } from "@grimoire/shared";
import { collectCampaignFiles } from "./campaign-fs";

// The row shape of GET /api/:campaign/search lives in @grimoire/shared
// (the app consumes it too); re-exported here for the server tests.
export type { SearchResult };

/** Entity kinds covered by the search index. */
const INDEXED_KINDS = new Set<EntityKind>(["scene", "npc", "location", "chapter"]);

/** One indexed document; the searchable fields feed the Fuse keys below. */
interface SearchDoc {
  kind: EntityKind;
  id: string;
  /** Display name: `title` for scenes/chapters, `name` for npcs/locations. */
  title: string;
  path: string;
  tags: string[];
  role?: string;
  location?: string;
  /** Raw markdown body, frontmatter stripped (ParsedFile.body). */
  body: string;
}

const MAX_RESULTS = 20;

// Weighting per issue #7: title/name over id/tags over the body (role and
// location sit in between). ignoreLocation because body matches can appear
// anywhere in the text, not near position 0; threshold 0.35 keeps the
// fuzziness moderate.
const FUSE_OPTIONS: IFuseOptions<SearchDoc> = {
  includeScore: true,
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: "title", weight: 3 },
    { name: "id", weight: 2 },
    { name: "tags", weight: 2 },
    { name: "role", weight: 1.5 },
    { name: "location", weight: 1.5 },
    { name: "body", weight: 1 },
  ],
};

const indexes = new Map<string, Fuse<SearchDoc>>();
const versions = new Map<string, number>();

/** Non-empty string or undefined — frontmatter is hand-edited, trust nothing. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Map a parsed file to an index document; null for non-indexed kinds. */
function toDoc(f: ParsedFile): SearchDoc | null {
  if (!INDEXED_KINDS.has(f.kind)) return null;
  const fm = f.frontmatter;
  const id = str(fm.id) ?? f.path;
  const doc: SearchDoc = {
    kind: f.kind,
    id,
    // The parser already falls back title/name -> id; this is belt and braces.
    title: str(fm.title) ?? str(fm.name) ?? id,
    path: f.path,
    tags: Array.isArray(fm.tags)
      ? fm.tags.filter((t) => t !== undefined && t !== null).map((t) => String(t))
      : [],
    body: f.body,
  };
  const role = str(fm.role);
  if (role !== undefined) doc.role = role;
  const location = str(fm.location);
  if (location !== undefined) doc.location = location;
  return doc;
}

async function buildIndex(campaign: string): Promise<Fuse<SearchDoc>> {
  const docs = (await collectCampaignFiles(campaign))
    .map(toDoc)
    .filter((d): d is SearchDoc => d !== null);
  return new Fuse(docs, FUSE_OPTIONS);
}

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

/**
 * Body context around the first literal (case-insensitive) occurrence of the
 * query. Purely a nice-to-have: fuzzy-only matches (typos) yield no literal
 * hit and therefore no snippet.
 */
function makeSnippet(body: string, query: string): string | undefined {
  const text = body.replace(/\s+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - SNIPPET_BEFORE);
  const end = Math.min(text.length, idx + query.length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Search one campaign, building (and caching) its index on first use.
 * Campaign existence/safety is checked inside collectCampaignFiles
 * (campaignDir: 400 unsafe id, 404 missing).
 */
export async function searchCampaign(campaign: string, query: string): Promise<SearchResult[]> {
  let fuse = indexes.get(campaign);
  if (fuse === undefined) {
    fuse = await buildIndex(campaign);
    indexes.set(campaign, fuse);
  }
  return fuse.search(query, { limit: MAX_RESULTS }).map(({ item, score }) => {
    const result: SearchResult = {
      kind: item.kind,
      id: item.id,
      title: item.title,
      path: item.path,
      score: score ?? 0,
    };
    const snippet = makeSnippet(item.body, query);
    if (snippet !== undefined) result.snippet = snippet;
    return result;
  });
}

/**
 * Drop a campaign's cached index (it rebuilds lazily on the next search)
 * and bump its version counter. Called by the watcher for every batch of
 * markdown changes; tests call it directly.
 */
export function invalidateCampaign(campaign: string): void {
  indexes.delete(campaign);
  versions.set(campaign, getCampaignVersion(campaign) + 1);
}

/** Current version counter of a campaign; starts at 0, bumps on invalidation. */
export function getCampaignVersion(campaign: string): number {
  return versions.get(campaign) ?? 0;
}
