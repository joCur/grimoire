// GET /api/campaigns/:campaign/search on FTS5.
//
// The index is `search_fts`, a real full-text index maintained by the store
// (./fts). The response is `{ results: SearchResult[] }`, max 20, with
// `score` meaning "0 is a perfect match, values grow toward 1".
//
// The search is truly mixed, so a hit names its entity by `kind` and `id`
// (ADR #31): the app opens the resource of that entity from those — or, for a
// glossary term, a row of a LIST (ADR #26), the glossary.
//
// The two properties the reference queries depend on:
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
// (title 10, ref 6, tags 4, body 1).

import { sql } from "drizzle-orm";
import type { EntityKind, SearchResult } from "@grimoire/shared";
import { requireCampaign } from "./campaigns";
import { getDb } from "./handle";

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
      score: scoreFromRank(Number(row.rank)),
    };
    const snippet = makeSnippet(row.body ?? "", query);
    if (snippet !== undefined) result.snippet = snippet;
    return result;
  });
}
