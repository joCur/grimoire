// GET /api/:campaign/search on FTS5 (issue #57; planning section 2).
//
// Fuse.js is gone: the index is now `search_fts`, a real full-text index
// maintained by the store (./fts). What did NOT change is the response —
// `{ results: SearchResult[] }`, max 20, same fields, `score` still "0 is a
// perfect match, values grow toward 1".
//
// The two properties the reference queries of issue #57 AK5 depend on:
//
//   * DIACRITIC FOLDING — the tokenizer is `unicode61 remove_diacritics 2`
//     (see the FTS migration), so "leucht" finds "Leuchtturm" and "muller"
//     finds "Müller".
//   * PREFIX SEARCH — every token is turned into a prefix term, so a
//     half-typed palette query ("jorna", "leucht") matches while the DM is
//     still typing. That is what replaces Fuse's fuzziness; genuine typo
//     tolerance would need a trigram tokenizer and is a documented later
//     option (planning section 8).
//
// Ranking is bm25 with the column weights of the migration
// (title 10, ref 6, tags 4, body 1) — the same priorities the Fuse key
// weights expressed.

import { sql } from "drizzle-orm";
import type { EntityKind, SearchResult } from "@grimoire/shared";
import { requireCampaign } from "./read";
import { getDb } from "./handle";
import { chapterPath, locationPath, npcPath, scenePath, sessionPath } from "./paths";
import type { GrimoireDb } from "../db/client";
import { eq, and } from "drizzle-orm";
import { scenes } from "../db/schema";

export type { SearchResult };

const MAX_RESULTS = 20;

/**
 * Turn free user input into an FTS5 MATCH expression: every token becomes a
 * quoted PREFIX term, and the terms are ANDed (FTS5's default).
 *
 * Quoting is what makes this safe — inside a `"…"` string FTS5 treats every
 * character as text, so a query full of operators (`AND`, `*`, `:`, `^`, a
 * stray quote) can never turn into syntax. A token that is nothing but
 * punctuation is dropped; a query with no usable token at all yields
 * undefined and the endpoint answers an empty result list.
 */
export function ftsQuery(input: string): string | undefined {
  const tokens = input
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length === 0) return undefined;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

/**
 * Body context around the first literal (case-insensitive) occurrence of the
 * query — unchanged from the Fuse implementation, including the fact that it
 * is a nice-to-have: a hit that only matched by prefix or by folded
 * diacritics yields no literal position and therefore no snippet.
 */
export function makeSnippet(body: string, query: string): string | undefined {
  const text = body.replace(/\s+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - SNIPPET_BEFORE);
  const end = Math.min(text.length, idx + query.length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * bm25 → the `score` field the API has always had. bm25 is negative and more
 * negative is better, so this maps it to `1 / (1 + -bm25)`: monotonically
 * increasing, 0-ish for a very strong hit, approaching 1 for a weak one —
 * the direction every existing consumer already sorts and displays by.
 */
export function scoreFromRank(rank: number): number {
  const positive = Math.max(0, -rank);
  return 1 / (1 + positive);
}

interface FtsRow {
  kind: string;
  entity_id: string;
  title: string;
  body: string;
  rank: number;
}

/** The path an indexed entity is addressed by (see ./paths). */
function pathForHit(db: GrimoireDb, campaign: string, kind: string, id: string): string {
  switch (kind) {
    case "scene": {
      const row = db
        .select({ chapterId: scenes.chapterId, groupSlug: scenes.groupSlug })
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, id)))
        .all()[0];
      return scenePath(row?.chapterId ?? "", row?.groupSlug ?? "", id);
    }
    case "npc":
      return npcPath(id);
    case "location":
      return locationPath(id);
    case "chapter":
      return chapterPath(id);
    case "session":
      return sessionPath(id);
    case "campaign":
      return "_campaign.md";
    case "glossary":
      return "glossary.md";
    default:
      return id;
  }
}

/**
 * Search one campaign. Campaign existence/safety is checked first (400 unsafe
 * id, 404 unknown campaign), exactly as the Fuse version did through
 * `collectCampaignFiles`.
 */
export async function searchCampaign(campaign: string, query: string): Promise<SearchResult[]> {
  await requireCampaign(campaign);
  const match = ftsQuery(query);
  if (match === undefined) return [];
  const db = await getDb();
  const rows = db.all<FtsRow>(sql`
    select kind, entity_id, title, body,
           bm25(search_fts, 10, 6, 4, 1) as rank
    from search_fts
    where campaign_id = ${campaign} and search_fts match ${match}
    order by rank
    limit ${MAX_RESULTS}
  `);
  return rows.map((row) => {
    const result: SearchResult = {
      kind: row.kind as EntityKind,
      id: row.entity_id,
      title: row.title === "" ? row.entity_id : row.title,
      path: pathForHit(db, campaign, row.kind, row.entity_id),
      score: scoreFromRank(Number(row.rank)),
    };
    const snippet = makeSnippet(row.body ?? "", query);
    if (snippet !== undefined) result.snippet = snippet;
    return result;
  });
}
