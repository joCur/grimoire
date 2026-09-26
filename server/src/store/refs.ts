// `[[slug]]` body references, server side.
//
// The renderer resolves references in the browser; the SEARCH INDEX cannot —
// FTS5 stores text, and a body that only says `[[jorna]]` would be findable
// under "jorna" but never under "Hafenmeisterin Jorna", which is the name the
// DM types into ⌘K and the name the page shows.
//
// THE CHOSEN SOLUTION — expand at INDEX time (the smallest one that holds):
// `indexEntity` gets the body with every resolved reference replaced by the
// current display name (@grimoire/shared/refs `expandRefs`). One extra
// query per index write, no new table, no new column, and the search snippet
// then reads exactly like the rendered page. Rejected alternatives: a second
// FTS column for reference names (same lookup, plus a schema migration and a
// weight to justify), and expanding at QUERY time (impossible — the query is
// a name, the index would still hold slugs).
//
// The price of expansion is that an index row can go stale for a reason
// OUTSIDE its own entity: when Jorna's display name changes, the scene that
// mentions her is unchanged but its indexed text is wrong. So every write
// that can change a display name re-indexes the REFERRING entities too
// (`reindexReferrers`). That is a `like '%[[slug]]%'` scan over four body
// columns of one campaign — cheap in a single-user tool, and precise, which
// is why it beats the pragmatic "reindex the whole campaign".
//
// SCOPE: every row whose body a DM writes prose in — scene, npc,
// location, chapter AND the campaign (`campaign`, the free note space), whose
// index row expands references (./campaigns.ts `indexCampaign`) and which
// `reindexReferrers` covers like any other. Glossary terms stay out — a term
// and its explanation are no prose body.
//
// CODE IS NOT PROSE: `` `[[jorna]]` `` and fenced blocks render literally, so
// the expansion may not touch them. That rule lives once,
// in @grimoire/shared/refs, and the renderer skips the same regions.

import { and, eq, like, sql } from "drizzle-orm";
import {
  REF_KINDS,
  bodyReferencesSlug,
  refSource,
  expandBodyRefs,
  type RefKind,
} from "@grimoire/shared/refs";
import type { GrimoireDb } from "../db/client";
import { campaigns, chapters, locations, npcs, scenes } from "../db/schema";

/** Body-bearing kinds that are scanned for references. */
export const REF_BODY_KINDS = ["scene", "npc", "location", "chapter", "campaign"] as const;
export type RefBodyKind = (typeof REF_BODY_KINDS)[number];

/** Display name of one slug IN ONE KIND, or undefined when it has no row. */
function displayNameOfKind(
  tx: GrimoireDb,
  campaign: string,
  kind: RefKind,
  slug: string,
): string | undefined {
  if (kind === "npc") {
    const row = tx
      .select({ name: npcs.name })
      .from(npcs)
      .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, slug)))
      .all()[0];
    return row === undefined ? undefined : row.name === "" ? slug : row.name;
  }
  if (kind === "location") {
    const row = tx
      .select({ name: locations.name })
      .from(locations)
      .where(and(eq(locations.campaignId, campaign), eq(locations.id, slug)))
      .all()[0];
    return row === undefined ? undefined : row.name === "" ? slug : row.name;
  }
  const row = tx
    .select({ title: scenes.title })
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, slug)))
    .all()[0];
  return row === undefined ? undefined : row.title === "" ? slug : row.title;
}

/**
 * The kind that OWNS a slug, by the documented KIND PRIORITY (npc > location
 * > scene — REF_KINDS, and the app's resolver walks the same order).
 * Undefined when nothing owns it.
 *
 * This is what makes a slug COLLISION safe. A scene and an npc may both be
 * called `jorna`, but `[[jorna]]` resolves to exactly ONE of them — so only
 * the owner may claim that prose: renaming the shadowed scene must leave
 * `[[jorna]]` untouched (it still points at the npc, and rewriting it would
 * HIJACK the sentence), and the scene's usage report must not count text that
 * names somebody else.
 */
export function refOwnerKind(
  tx: GrimoireDb,
  campaign: string,
  slug: string,
): RefKind | undefined {
  for (const kind of REF_KINDS) {
    if (displayNameOfKind(tx, campaign, kind, slug) !== undefined) return kind;
  }
  return undefined;
}

/**
 * Display name of one slug, resolved with the documented KIND PRIORITY.
 * Undefined when nothing owns the slug: the reference then keeps its
 * brackets, in the index exactly as on screen.
 */
export function refDisplayName(
  tx: GrimoireDb,
  campaign: string,
  slug: string,
): string | undefined {
  for (const kind of REF_KINDS) {
    const name = displayNameOfKind(tx, campaign, kind, slug);
    if (name !== undefined) return name;
  }
  return undefined;
}

/**
 * The text that goes into the search index: the body with every resolved
 * `[[slug]]` replaced by the current display name — CODE REGIONS EXCLUDED,
 * because a reference inside them is literal text on the page too. Bodies
 * without a reference come back untouched without a single query.
 */
export function expandCampaignBodyRefs(tx: GrimoireDb, campaign: string, body: string): string {
  if (!body.includes("[[")) return body;
  const cache = new Map<string, string | undefined>();
  return expandBodyRefs(body, (slug) => {
    if (!cache.has(slug)) cache.set(slug, refDisplayName(tx, campaign, slug));
    return cache.get(slug);
  });
}

/**
 * Expand the references in the ALREADY INDEXED text of a whole campaign —
 * the seed's second pass (db/seed.ts).
 *
 * The seed writes each index row as it goes, and a body can
 * reference a row that has no index row yet at that moment (a chapter text
 * naming an npc loaded later in the same pass). So the expansion cannot
 * happen while loading; it happens once at the end, over `search_fts`
 * itself rather than over the bodies — which keeps it kind-agnostic
 * and preserves whatever the indexer decided the indexed text is (an npc's
 * indexed text includes its `## Beziehungen`, for instance).
 */
export function expandIndexedRefs(tx: GrimoireDb, campaign: string): number {
  const rows = tx.all<{ kind: string; entity_id: string; body: string }>(sql`
    select kind, entity_id, body from search_fts
    where campaign_id = ${campaign} and body like '%[[%'
  `);
  let changed = 0;
  for (const row of rows) {
    const body = expandCampaignBodyRefs(tx, campaign, row.body ?? "");
    if (body === row.body) continue;
    changed += 1;
    tx.run(sql`
      update search_fts set body = ${body}
      where campaign_id = ${campaign} and kind = ${row.kind} and entity_id = ${row.entity_id}
    `);
  }
  return changed;
}

/**
 * The table of each body kind and the PROSE a reference can stand in: the
 * body, and for an npc and a location also the prose property the card shows
 * (`motivation`, `atmosphere`). A `[[slug]]` there reads as a name on the card
 * and is expanded in the index (./search-index.ts `indexedProse`), so a
 * renamed target has to find these rows too.
 */
const REF_TABLES = {
  scene: { table: scenes, prose: sql<string>`${scenes.body}` },
  npc: {
    table: npcs,
    prose: sql<string>`coalesce(${npcs.motivation}, '') || char(10) || char(10) || ${npcs.body}`,
  },
  location: {
    table: locations,
    prose: sql<string>`coalesce(${locations.atmosphere}, '') || char(10) || char(10) || ${locations.body}`,
  },
  chapter: { table: chapters, prose: sql<string>`${chapters.body}` },
} as const;

/** One referring row with the body the check works on. */
interface ReferrerRow {
  kind: RefBodyKind;
  id: string;
  body: string;
}

/**
 * Candidate bodies for `[[slug]]` and the rows they belong to.
 *
 * The `like` is only a PRE-FILTER — SQL cannot tell prose from code, so every
 * candidate is confirmed in JS with the shared grammar. The campaign row is
 * keyed by its own id (it IS the campaign) and therefore not part of the
 * generic table loop.
 */
function referrerRows(tx: GrimoireDb, campaign: string, slug: string): ReferrerRow[] {
  const needle = `%${refSource(slug)}%`;
  const rows: ReferrerRow[] = [];
  for (const kind of REF_BODY_KINDS) {
    if (kind === "campaign") {
      const row = tx
        .select({ id: campaigns.id, body: campaigns.body })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaign), like(campaigns.body, needle)))
        .all()[0];
      if (row !== undefined) rows.push({ kind, id: row.id, body: row.body });
      continue;
    }
    const { table, prose } = REF_TABLES[kind];
    for (const row of tx
      .select({ id: table.id, body: prose })
      .from(table)
      .where(and(eq(table.campaignId, campaign), like(prose, needle)))
      .orderBy(table.id)
      .all()) {
      rows.push({ kind, id: row.id, body: row.body });
    }
  }
  return rows.filter((row) => bodyReferencesSlug(row.body, slug));
}

/** Ids of the entities whose PROSE (see `REF_TABLES`) contains `[[slug]]`, per kind. */
export function referrersOf(
  tx: GrimoireDb,
  campaign: string,
  slug: string,
): Array<{ kind: RefBodyKind; id: string }> {
  return referrerRows(tx, campaign, slug).map((row) => ({ kind: row.kind, id: row.id }));
}

