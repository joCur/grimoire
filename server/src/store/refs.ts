// `[[slug]]` body references, server side (issue #68).
//
// The renderer resolves references in the browser; the SEARCH INDEX cannot —
// FTS5 stores text, and a body that only says `[[jorna]]` would be findable
// under "jorna" but never under "Hafenmeisterin Jorna", which is the name the
// DM types into ⌘K and the name the page shows.
//
// THE CHOSEN SOLUTION — expand at INDEX time (the smallest one that holds):
// `indexEntity` gets the body with every resolved reference replaced by the
// current display name (@grimoire/shared/refs `expandEntityRefs`). One extra
// query per index write, no new table, no new column, and the search snippet
// then reads exactly like the rendered page. Rejected alternatives: a second
// FTS column for reference names (same lookup, plus a schema migration and a
// weight to justify), and expanding at QUERY time (impossible — the query is
// a name, the index would still hold slugs).
//
// The price of expansion is that an index row can go stale for a reason
// OUTSIDE its own entity: if Jorna is renamed, the scene that mentions her is
// unchanged but its indexed text is wrong. So every write that can change a
// display name or an id re-indexes the REFERRING entities too
// (`reindexReferrers`). That is a `like '%[[slug]]%'` scan over four body
// columns of one campaign — cheap in a single-user tool, and precise, which
// is why it beats the pragmatic "reindex the whole campaign".
//
// SCOPE: the four kinds with a body that a DM writes prose in (scene, npc,
// location, chapter). The campaign file and the glossary are deliberately not
// scanned — nothing points at an entity from there today, and a scan that
// includes them would have to invent a usage site kind for them.

import { and, eq, like, sql } from "drizzle-orm";
import { ENTITY_REF_KINDS, expandEntityRefs, entityRefSource } from "@grimoire/shared/refs";
import type { GrimoireDb } from "../db/client";
import { chapters, locations, npcs, scenes } from "../db/schema";

/** Body-bearing kinds that are scanned for references. */
export const REF_BODY_KINDS = ["scene", "npc", "location", "chapter"] as const;
export type RefBodyKind = (typeof REF_BODY_KINDS)[number];

/**
 * Display name of one slug, resolved with the documented KIND PRIORITY
 * (npc > location > scene — ENTITY_REF_KINDS, and the app's resolver walks
 * the same order). Undefined when nothing owns the slug: the reference then
 * keeps its brackets, in the index exactly as on screen.
 */
export function refDisplayName(
  tx: GrimoireDb,
  campaign: string,
  slug: string,
): string | undefined {
  for (const kind of ENTITY_REF_KINDS) {
    if (kind === "npc") {
      const row = tx
        .select({ name: npcs.name })
        .from(npcs)
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, slug)))
        .all()[0];
      if (row !== undefined) return row.name === "" ? slug : row.name;
    } else if (kind === "location") {
      const row = tx
        .select({ name: locations.name })
        .from(locations)
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, slug)))
        .all()[0];
      if (row !== undefined) return row.name === "" ? slug : row.name;
    } else {
      const row = tx
        .select({ title: scenes.title })
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, slug)))
        .all()[0];
      if (row !== undefined) return row.title === "" ? slug : row.title;
    }
  }
  return undefined;
}

/**
 * The text that goes into the search index: the body with every resolved
 * `[[slug]]` replaced by the current display name. Bodies without a reference
 * come back untouched without a single query.
 */
export function expandBodyRefs(tx: GrimoireDb, campaign: string, body: string): string {
  if (!body.includes("[[")) return body;
  const cache = new Map<string, string | undefined>();
  return expandEntityRefs(body, (slug) => {
    if (!cache.has(slug)) cache.set(slug, refDisplayName(tx, campaign, slug));
    return cache.get(slug);
  });
}

/**
 * Expand the references in the ALREADY INDEXED text of a whole campaign —
 * the import's second pass (db/migrate-campaigns.ts).
 *
 * The import writes one index row per entity as it goes, and a body can
 * reference an entity that has no row yet at that moment (a chapter text
 * naming an npc, imported earlier in the same pass). So the expansion cannot
 * happen while importing; it happens once at the end, over `search_fts`
 * itself rather than over the source bodies — which keeps it kind-agnostic
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
    const body = expandBodyRefs(tx, campaign, row.body ?? "");
    if (body === row.body) continue;
    changed += 1;
    tx.run(sql`
      update search_fts set body = ${body}
      where campaign_id = ${campaign} and kind = ${row.kind} and entity_id = ${row.entity_id}
    `);
  }
  return changed;
}

const REF_TABLES = {
  scene: scenes,
  npc: npcs,
  location: locations,
  chapter: chapters,
} as const;

/** Ids of the entities whose body contains `[[slug]]`, per kind. */
export function referrersOf(
  tx: GrimoireDb,
  campaign: string,
  slug: string,
): Array<{ kind: RefBodyKind; id: string }> {
  const needle = `%${entityRefSource(slug)}%`;
  const found: Array<{ kind: RefBodyKind; id: string }> = [];
  for (const kind of REF_BODY_KINDS) {
    const table = REF_TABLES[kind];
    for (const row of tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.campaignId, campaign), like(table.body, needle)))
      .orderBy(table.id)
      .all()) {
      found.push({ kind, id: row.id });
    }
  }
  return found;
}

/**
 * Rewrite `[[oldSlug]]` to `[[newSlug]]` in every body that carries it — the
 * body reference is a SOFT reference (schema.ts rule 3) and the rename
 * cascade has to drag it along, or the DM's prose silently loses its links.
 * Returns the entities whose body changed, so the caller can re-index them.
 */
export function rewriteBodyRefs(
  tx: GrimoireDb,
  campaign: string,
  oldSlug: string,
  newSlug: string,
): Array<{ kind: RefBodyKind; id: string }> {
  const affected = referrersOf(tx, campaign, oldSlug);
  const from = entityRefSource(oldSlug);
  const to = entityRefSource(newSlug);
  for (const kind of REF_BODY_KINDS) {
    const table = REF_TABLES[kind];
    if (!affected.some((entity) => entity.kind === kind)) continue;
    tx.update(table)
      .set({ body: sql`replace(${table.body}, ${from}, ${to})` })
      .where(and(eq(table.campaignId, campaign), like(table.body, `%${from}%`)))
      .run();
  }
  return affected;
}
