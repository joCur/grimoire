// Glossary terms: the glossary-term resource.
//
// A glossary term is its own resource with its own type (ADR #31,
// @grimoire/shared/glossary-term): listed, read, created, written and
// deleted here, typed by its one zod schema. Every term carries its own guard
// `rev`, and a term stands in the glossary once (409 `glossary_term_taken`).
// Terms stand in the order they were created (`pos`, db/schema.ts); nothing
// reorders them.
//
// A term is searchable, so every write keeps its index row; and the terms
// become a block of the generator's prompt (`glossaryText`).

import { randomUUID } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  glossaryTermCreateSchema,
  glossaryTermDeleteSchema,
  glossaryTermPatchSchema,
  glossaryTermSeedSchema,
  type GlossaryTerm,
  type GlossaryTermCreate,
  type GlossaryTermDelete,
  type GlossaryTermPatch,
  type GlossaryTermSeed,
} from "@grimoire/shared/glossary-term";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { glossaryTerms } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { dropEntity, indexEntity } from "./fts";
import { getDb } from "./handle";
import { promptInline } from "./knowledge-items";
import { nextPos, parseRequest, revConflict } from "./shared";

/** One stored glossary-term row. */
type GlossaryTermRow = typeof glossaryTerms.$inferSelect;

/** The search-index kind of a term — what a search hit names it by. */
const INDEX_KIND = "glossary-term";

// --- rendering and reading ----------------------------------------------------

/** The term of a row: every field flat. */
function renderGlossaryTerm(row: GlossaryTermRow): GlossaryTerm {
  return { id: row.id, term: row.term, explanation: row.explanation, rev: row.rev };
}

/** The term with this id; 404 when the campaign has none. */
function requireGlossaryTermRow(tx: GrimoireDb, campaign: string, id: string): GlossaryTermRow {
  const row = tx
    .select()
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.campaignId, campaign), eq(glossaryTerms.id, id)))
    .all()[0];
  if (row === undefined) throw new ApiError(404, "glossary term not found");
  return row;
}

/** The campaign's term rows in the order they were created (the id as the tie-break). */
function glossaryTermRows(db: GrimoireDb, campaign: string): GlossaryTermRow[] {
  return db
    .select()
    .from(glossaryTerms)
    .where(eq(glossaryTerms.campaignId, campaign))
    .orderBy(asc(glossaryTerms.pos), asc(glossaryTerms.id))
    .all();
}

/**
 * GET /api/campaigns/:campaign/glossary-terms — every term of the campaign in
 * the order it was created. No terms is an empty list (200).
 */
export async function listGlossaryTerms(campaign: string): Promise<GlossaryTerm[]> {
  await requireCampaign(campaign);
  return glossaryTermRows(await getDb(), campaign).map(renderGlossaryTerm);
}

/** GET /api/campaigns/:campaign/glossary-terms/:id */
export async function readGlossaryTerm(campaign: string, id: string): Promise<GlossaryTerm> {
  await requireCampaign(campaign);
  return renderGlossaryTerm(requireGlossaryTermRow(await getDb(), campaign, id));
}

// --- writing ------------------------------------------------------------------

/**
 * A term stands in the glossary once: the 409 `glossary_term_taken` when
 * another term of the campaign already reads `term`. `except` is the term
 * being written, which may keep its own wording.
 */
function assertTermFree(tx: GrimoireDb, campaign: string, term: string, except?: string): void {
  const taken = tx
    .select({ id: glossaryTerms.id })
    .from(glossaryTerms)
    .where(
      and(
        eq(glossaryTerms.campaignId, campaign),
        eq(glossaryTerms.term, term),
        ...(except === undefined ? [] : [ne(glossaryTerms.id, except)]),
      ),
    )
    .all()[0];
  if (taken !== undefined) {
    throw new ApiError(409, `the glossary already has the term "${term}"`, {
      code: "glossary_term_taken",
      term,
    });
  }
}

/** The body of a term POST, checked against the term's create form. */
export function readGlossaryTermCreate(raw: unknown): GlossaryTermCreate {
  return parseRequest(glossaryTermCreateSchema, raw, "glossary term");
}

/**
 * POST /api/campaigns/:campaign/glossary-terms `{ term, explanation? }` — a
 * new term at the end, with an id the server hands out. A term the glossary
 * already has is 409 `glossary_term_taken` and writes nothing.
 */
export async function createGlossaryTerm(
  campaign: string,
  request: GlossaryTermCreate,
): Promise<GlossaryTerm> {
  return mutate(campaign, (tx) => {
    assertTermFree(tx, campaign, request.term);
    const id = randomUUID();
    tx.insert(glossaryTerms)
      .values({
        campaignId: campaign,
        id,
        term: request.term,
        explanation: request.explanation ?? "",
        pos: nextGlossaryTermPos(tx, campaign),
      })
      .run();
    const row = requireGlossaryTermRow(tx, campaign, id);
    indexGlossaryTerm(tx, campaign, row);
    return renderGlossaryTerm(row);
  });
}

/**
 * The body of a term PATCH, checked against the term's schema: the guard,
 * `force` and any subset of the fields — a key that is none of these, or a
 * value of the wrong shape, is a 400 that names it.
 */
export function readGlossaryTermPatch(raw: unknown): GlossaryTermPatch {
  return parseRequest(glossaryTermPatchSchema, raw, "glossary term patch");
}

/**
 * PATCH /api/campaigns/:campaign/glossary-terms/:id — any subset of the
 * term's fields in one row update against one `rev`. Rewording it into a term
 * the glossary already has is 409 `glossary_term_taken`. A patch that names
 * no field is 400 `nothing_to_write`; the id may be echoed, never changed.
 *
 * A stale `rev` is 409 with the current term under `glossaryTerm`; `force`
 * writes the given fields on top of it instead. An unknown id is 404.
 */
export async function patchGlossaryTerm(
  campaign: string,
  id: string,
  patch: GlossaryTermPatch,
): Promise<GlossaryTerm> {
  const { rev, force, id: patchedId, ...fields } = patch;
  if (!Object.values(fields).some((value) => value !== undefined) && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const row = requireGlossaryTermRow(tx, campaign, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "glossary term changed", { glossaryTerm: renderGlossaryTerm(row) });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    if (fields.term !== undefined) assertTermFree(tx, campaign, fields.term, row.id);
    const next: GlossaryTermRow = {
      ...row,
      term: fields.term ?? row.term,
      explanation: fields.explanation ?? row.explanation,
      rev: row.rev + 1,
    };
    tx.update(glossaryTerms)
      .set({ term: next.term, explanation: next.explanation, rev: next.rev })
      .where(and(eq(glossaryTerms.campaignId, campaign), eq(glossaryTerms.id, row.id)))
      .run();
    indexGlossaryTerm(tx, campaign, next);
    return renderGlossaryTerm(next);
  });
}

/** The body of a term DELETE: the guard the term was read with. */
export function readGlossaryTermDelete(raw: unknown): GlossaryTermDelete {
  return parseRequest(glossaryTermDeleteSchema, raw, "glossary term delete");
}

/**
 * DELETE /api/campaigns/:campaign/glossary-terms/:id `{ rev }` — remove one
 * term and its index row. A stale `rev` is 409 with the current term under
 * `glossaryTerm` and removes nothing; an unknown id is 404.
 */
export async function deleteGlossaryTerm(
  campaign: string,
  id: string,
  request: GlossaryTermDelete,
): Promise<void> {
  await mutate(campaign, (tx) => {
    const row = requireGlossaryTermRow(tx, campaign, id);
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "glossary term changed", { glossaryTerm: renderGlossaryTerm(row) });
    }
    tx.delete(glossaryTerms)
      .where(and(eq(glossaryTerms.campaignId, campaign), eq(glossaryTerms.id, row.id)))
      .run();
    dropEntity(tx, campaign, INDEX_KIND, row.id);
  });
}

/** The one past the highest `pos` of the campaign — where a new term stands. */
function nextGlossaryTermPos(tx: GrimoireDb, campaign: string): number {
  return nextPos(
    tx
      .select({ pos: glossaryTerms.pos })
      .from(glossaryTerms)
      .where(eq(glossaryTerms.campaignId, campaign))
      .all(),
  );
}

// --- the seed -----------------------------------------------------------------

/**
 * A term without its guard — a fixture — checked against the term's schema.
 * A key a term does not have, or a value of the wrong shape, is refused with
 * the message `what` introduces.
 */
export function readGlossaryTermSeed(raw: unknown, what: string): GlossaryTermSeed {
  return parseRequest(glossaryTermSeedSchema, raw, what);
}

/**
 * Write one term of a fixture, at the end, INSIDE the caller's transaction,
 * with its index row. A term the fixture names twice is refused by the
 * database's unique index.
 */
export function insertGlossaryTermSeed(tx: GrimoireDb, campaign: string, seed: GlossaryTermSeed): void {
  tx.insert(glossaryTerms)
    .values({
      campaignId: campaign,
      id: seed.id,
      term: seed.term,
      explanation: seed.explanation,
      pos: nextGlossaryTermPos(tx, campaign),
    })
    .run();
  indexGlossaryTerm(tx, campaign, requireGlossaryTermRow(tx, campaign, seed.id));
}

// --- the search index row of a term ------------------------------------------

function indexGlossaryTerm(tx: GrimoireDb, campaign: string, row: GlossaryTermRow): void {
  indexEntity(tx, campaign, {
    kind: INDEX_KIND,
    entityId: row.id,
    title: row.term,
    ref: row.term,
    tags: "",
    body: row.explanation,
  });
}

// --- the prompt block ---------------------------------------------------------

/**
 * The glossary as the generator's context block — the `EN → DE` lines the
 * prompt texts (generator.ts), in the order the terms were created.
 */
export async function glossaryText(campaign: string): Promise<string | undefined> {
  const rows = glossaryTermRows(await getDb(), campaign);
  if (rows.length === 0) return undefined;
  // Same one-line-per-item guarantee the knowledge lines have
  // (./knowledge-items.ts `promptInline`): the glossary is quoted into the
  // same prompt and is no more trustworthy as a source of markdown structure.
  return rows
    .map((row) => `- ${promptInline(row.term)} → ${promptInline(row.explanation)}`)
    .join("\n");
}
