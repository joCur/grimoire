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
// SCOPE: every document whose body a DM writes prose in — scene, npc,
// location, chapter AND the campaign file (`_campaign`, the free note
// space). The campaign file used to be scanned HALF: its index row expanded
// references (write.ts `indexCampaign`) but no scan ever found it again, so a
// rename left a stale name in the search index and a dead slug in the note.
// It is now a FULL body kind: `reindexReferrers` and `rewriteBodyRefs` cover
// it, and it counts as a usage site like any other document. The glossary
// stays out — its rows are term/explanation pairs, not a prose body.
//
// CODE IS NOT PROSE: `` `[[jorna]]` `` and fenced blocks render literally, so
// neither the expansion nor the rename may touch them. That rule lives once,
// in @grimoire/shared/refs, and the renderer skips the same regions.

import { and, eq, like, sql } from "drizzle-orm";
import {
  ENTITY_REF_KINDS,
  bodyReferencesEntity,
  entityRefSource,
  expandBodyEntityRefs,
  rewriteBodyEntityRefs,
  type EntityRefKind,
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
  kind: EntityRefKind,
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
 * > scene — ENTITY_REF_KINDS, and the app's resolver walks the same order).
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
): EntityRefKind | undefined {
  for (const kind of ENTITY_REF_KINDS) {
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
  for (const kind of ENTITY_REF_KINDS) {
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
export function expandBodyRefs(tx: GrimoireDb, campaign: string, body: string): string {
  if (!body.includes("[[")) return body;
  const cache = new Map<string, string | undefined>();
  return expandBodyEntityRefs(body, (slug) => {
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

/** One referring document with the body the check and the rewrite work on. */
interface ReferrerRow {
  kind: RefBodyKind;
  id: string;
  body: string;
}

/**
 * Candidate bodies for `[[slug]]` and the documents they belong to.
 *
 * The `like` is only a PRE-FILTER — SQL cannot tell prose from code, so every
 * candidate is confirmed in JS with the shared grammar. The campaign row is
 * keyed by its own id (it IS the campaign) and therefore not part of the
 * generic table loop.
 */
function referrerRows(tx: GrimoireDb, campaign: string, slug: string): ReferrerRow[] {
  const needle = `%${entityRefSource(slug)}%`;
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
    const table = REF_TABLES[kind];
    for (const row of tx
      .select({ id: table.id, body: table.body })
      .from(table)
      .where(and(eq(table.campaignId, campaign), like(table.body, needle)))
      .orderBy(table.id)
      .all()) {
      rows.push({ kind, id: row.id, body: row.body });
    }
  }
  return rows.filter((row) => bodyReferencesEntity(row.body, slug));
}

/** Ids of the entities whose body PROSE contains `[[slug]]`, per kind. */
export function referrersOf(
  tx: GrimoireDb,
  campaign: string,
  slug: string,
): Array<{ kind: RefBodyKind; id: string }> {
  return referrerRows(tx, campaign, slug).map((row) => ({ kind: row.kind, id: row.id }));
}

/** Write one body back, in the caller's transaction. */
function setBody(
  tx: GrimoireDb,
  campaign: string,
  kind: RefBodyKind,
  id: string,
  body: string,
): void {
  if (kind === "campaign") {
    tx.update(campaigns).set({ body }).where(eq(campaigns.id, campaign)).run();
    return;
  }
  const table = REF_TABLES[kind];
  tx.update(table)
    .set({ body })
    .where(and(eq(table.campaignId, campaign), eq(table.id, id)))
    .run();
}

/**
 * Rewrite `[[oldSlug]]` to `[[newSlug]]` in every body that carries it — the
 * body reference is a SOFT reference (schema.ts rule 3) and the rename
 * cascade has to drag it along, or the DM's prose silently loses its links.
 * Returns the entities whose body changed, so the caller can re-index them.
 *
 * The rewrite happens IN JS, one body at a time, not as a SQL `replace`: the
 * `replace` hit every occurrence, `` `[[jorna]]` `` in a code span included,
 * and the DM's literal example silently turned into a different slug. Loading
 * the body is what buys the shared skip logic — and the bodies are the ones
 * the pre-filter already found, so nothing extra is read.
 */
export function rewriteBodyRefs(
  tx: GrimoireDb,
  campaign: string,
  oldSlug: string,
  newSlug: string,
): Array<{ kind: RefBodyKind; id: string }> {
  const affected: Array<{ kind: RefBodyKind; id: string }> = [];
  for (const row of referrerRows(tx, campaign, oldSlug)) {
    const body = rewriteBodyEntityRefs(row.body, oldSlug, newSlug);
    if (body === row.body) continue;
    setBody(tx, campaign, row.kind, row.id, body);
    affected.push({ kind: row.kind, id: row.id });
  }
  return affected;
}
