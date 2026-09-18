// The glossary: the DM's `EN → DE` list for the table.
//
// A list of rows with its own guard token (`campaigns.glossary_rev`), read
// and written as a whole — the order of the entries IS the stored order, so
// reordering on the glossary page (/campaigns/:id/glossary) is the same
// request as editing. A term is
// searchable, so every write keeps its own index rows; and the same list
// becomes a block of the generator's prompt.

import { asc, eq, sql } from "drizzle-orm";
import type { GlossaryResponse } from "@grimoire/shared";
import type { GrimoireDb } from "../db/client";
import { campaigns, glossary } from "../db/schema";
import { mutate, requireCampaign, requireCampaignRow } from "./campaigns";
import { indexEntity } from "./fts";
import { getDb } from "./handle";
import { promptInline } from "./knowledge";
import type { GlossaryRow } from "./render";
import { guardRev } from "./shared";

// --- the stored rows ----------------------------------------------------------

export function glossaryRows(db: GrimoireDb, campaign: string): GlossaryRow[] {
  return db
    .select({
      term: glossary.term,
      explanation: glossary.explanation,
      pos: glossary.pos,
      rev: glossary.rev,
    })
    .from(glossary)
    .where(eq(glossary.campaignId, campaign))
    .orderBy(asc(glossary.pos), asc(glossary.term))
    .all() as GlossaryRow[];
}

/**
 * GET /api/campaigns/:campaign/glossary -> `{ entries, rev }`.
 *
 * `rev` travels with it: the glossary page edits this list, so it needs the
 * same guard token every other editable thing has. It is the LIST's counter
 * (`campaigns.glossary_rev`) and not `campaigns.version`, which every
 * unrelated write bumps — that would make a glossary edit the DM had open
 * unsaveable during a running session.
 */
export async function readGlossary(campaign: string): Promise<GlossaryResponse> {
  const row = await requireCampaign(campaign);
  const db = await getDb();
  return {
    entries: glossaryRows(db, campaign).map((r) => ({
      term: r.term,
      explanation: r.explanation,
    })),
    rev: row.glossaryRev,
  };
}

// --- PUT /api/campaigns/:campaign/glossary -----------------------------------

/** Replace the whole glossary of a campaign (PUT /glossary). */
function writeGlossaryRows(
  tx: GrimoireDb,
  campaign: string,
  entries: Array<{ term: string; explanation: string }>,
): void {
  // The whole list is replaced, so the index rows go in one statement rather
  // than one per term — a term that disappears must not survive in search.
  tx.run(sql`delete from search_fts where campaign_id = ${campaign} and kind = 'glossary'`);
  tx.delete(glossary).where(eq(glossary.campaignId, campaign)).run();
  const seen = new Set<string>();
  let pos = 0;
  for (const entry of entries) {
    const term = entry.term.trim();
    if (term === "" || seen.has(term)) continue; // first one wins
    seen.add(term);
    tx.insert(glossary)
      .values({ campaignId: campaign, term, explanation: entry.explanation, pos: pos++ })
      .run();
    indexGlossaryTerm(tx, campaign, term, entry.explanation);
  }
}

/**
 * PUT /api/campaigns/:campaign/glossary `{ entries, rev }` -> the stored list + its
 * fresh `rev`.
 *
 * The ORDER of `entries` is the stored order — that is what the settings
 * page's reordering writes: there is no separate "move" endpoint,
 * because a list this short is one entry and a move is simply a different
 * entry.
 *
 * `rev` is REQUIRED, for the reason every other editable thing has one: a
 * whole-list PUT without a guard is exactly the silent overwrite ADR #4
 * forbids. An `undefined` rev is refused by the endpoint, not defaulted here.
 */
export async function writeGlossary(
  campaign: string,
  entries: Array<{ term: string; explanation: string }>,
  rev: number,
): Promise<GlossaryResponse> {
  return mutate(campaign, (tx) => {
    const row = requireCampaignRow(tx, campaign);
    // A list guard, not an entry guard: the 409 carries the current `rev` and
    // no entry, because the glossary is not one (ADR #26). The glossary page
    // reloads the list itself.
    guardRev(row.glossaryRev, rev, "glossary changed");
    writeGlossaryRows(tx, campaign, entries);
    const nextRev = row.glossaryRev + 1;
    tx.update(campaigns)
      .set({ glossaryRev: nextRev })
      .where(eq(campaigns.id, campaign))
      .run();
    return {
      entries: glossaryRows(tx, campaign).map((r) => ({
        term: r.term,
        explanation: r.explanation,
      })),
      rev: nextRev,
    };
  });
}

// --- the search index row of a term ------------------------------------------

export function indexGlossaryTerm(
  tx: GrimoireDb,
  campaign: string,
  term: string,
  explanation: string,
): void {
  indexEntity(tx, campaign, {
    kind: "glossary",
    entityId: term,
    title: term,
    ref: term,
    tags: "",
    body: explanation,
  });
}

// --- the prompt block ---------------------------------------------------------

/**
 * The glossary as the generator's context block — the `EN → DE` lines the
 * prompt texts (generator.ts).
 */
export async function glossaryText(campaign: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = glossaryRows(db, campaign);
  if (rows.length === 0) return undefined;
  // Same one-line-per-entry guarantee the knowledge lines have
  // (./knowledge.ts `promptInline`): the glossary is quoted into the same
  // prompt and is no more trustworthy as a source of markdown structure.
  return rows
    .map((row) => `- ${promptInline(row.term)} → ${promptInline(row.explanation)}`)
    .join("\n");
}
