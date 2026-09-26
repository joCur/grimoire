// Knowledge items: the knowledge-item resource and the order of the items.
//
// A knowledge item — a naming convention, a fact or a style rule the DM keeps
// on the campaign's knowledge page (/campaigns/:id/knowledge) — is its own
// resource with its own type (ADR #31, @grimoire/shared/knowledge-item):
// listed, read, created, written and deleted here, typed by its one zod
// schema. Every item carries its own guard `rev`.
//
// The ORDER of the items is the order of the prompt, and the DM sets it. It
// is written on its own (`writeKnowledgeItemOrder`) and guarded by the
// campaign's `knowledge_item_order_rev`, which no item write and no campaign
// write moves — and which in turn moves no item's `rev`.
//
// Their second job is the generator's: the same rows become the
// `## Kampagnenwissen` block of the prompt and the input of the post-run
// naming check, with `[[slug]]` references resolved and every item flattened
// to one line.

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  isKnowledgeKind,
  knowledgeItemCreateSchema,
  knowledgeItemDeleteSchema,
  knowledgeItemOrderSchema,
  knowledgeItemPatchSchema,
  knowledgeItemSeedSchema,
  type KnowledgeItem,
  type KnowledgeItemCreate,
  type KnowledgeItemDelete,
  type KnowledgeItemOrder,
  type KnowledgeItemPatch,
  type KnowledgeItemSeed,
} from "@grimoire/shared/knowledge-item";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { campaigns, knowledgeItems } from "../db/schema";
import { mutate, requireCampaign, requireCampaignRow } from "./campaigns";
import { getDb } from "./handle";
import { expandCampaignBodyRefs } from "./refs";
import { nextPos, parseRequest, revConflict } from "./shared";

/** One stored knowledge-item row. */
type KnowledgeItemRow = typeof knowledgeItems.$inferSelect;

// --- rendering and reading ----------------------------------------------------

/**
 * The item of a row: every field flat. `kind` is whatever the column holds,
 * so a value no build writes degrades to `fact` on the way OUT instead of
 * making the read fail (CLAUDE.md, "Format degradiert").
 */
function renderKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  return {
    id: row.id,
    kind: isKnowledgeKind(row.kind) ? row.kind : "fact",
    from: row.fromText,
    to: row.toText,
    text: row.text,
    rev: row.rev,
  };
}

/** The item with this id; 404 when the campaign has none. */
function requireKnowledgeItemRow(tx: GrimoireDb, campaign: string, id: string): KnowledgeItemRow {
  const row = tx
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.campaignId, campaign), eq(knowledgeItems.id, id)))
    .all()[0];
  if (row === undefined) throw new ApiError(404, "knowledge item not found");
  return row;
}

/** The campaign's item rows in their order (the id as the tie-break). */
function knowledgeItemRows(db: GrimoireDb, campaign: string): KnowledgeItemRow[] {
  return db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.campaignId, campaign))
    .orderBy(asc(knowledgeItems.pos), asc(knowledgeItems.id))
    .all();
}

/**
 * GET /api/campaigns/:campaign/knowledge-items — every item of the campaign
 * in its order. No items is an empty list (200).
 */
export async function listKnowledgeItems(campaign: string): Promise<KnowledgeItem[]> {
  await requireCampaign(campaign);
  return knowledgeItemRows(await getDb(), campaign).map(renderKnowledgeItem);
}

/** GET /api/campaigns/:campaign/knowledge-items/:id */
export async function readKnowledgeItem(campaign: string, id: string): Promise<KnowledgeItem> {
  await requireCampaign(campaign);
  return renderKnowledgeItem(requireKnowledgeItemRow(await getDb(), campaign, id));
}

// --- writing ------------------------------------------------------------------

/**
 * One more change of the ORDER: a new item at the end or one removed moves
 * the order's guard like a reorder does, so an order written against the
 * list before that change is a 409 instead of a list that names too few or
 * too many items.
 */
function bumpKnowledgeItemOrder(tx: GrimoireDb, campaign: string): number {
  const next = requireCampaignRow(tx, campaign).knowledgeItemOrderRev + 1;
  tx.update(campaigns).set({ knowledgeItemOrderRev: next }).where(eq(campaigns.id, campaign)).run();
  return next;
}

/** The body of an item POST, checked against the item's create form. */
export function readKnowledgeItemCreate(raw: unknown): KnowledgeItemCreate {
  return parseRequest(knowledgeItemCreateSchema, raw, "knowledge item");
}

/**
 * POST /api/campaigns/:campaign/knowledge-items `{ kind, from?, to?, text? }`
 * — a new item at the end of the order, with an id the server hands out. A
 * field left out is empty.
 *
 * ITEMS ARE NOT REFUSED for being half-filled: an empty `to` is a convention
 * the DM has not finished typing, and refusing the save would lose work. The
 * PROMPT skips those lines instead (`knowledgeText` below), which is where an
 * incomplete rule can actually do damage.
 */
export async function createKnowledgeItem(
  campaign: string,
  request: KnowledgeItemCreate,
): Promise<KnowledgeItem> {
  return mutate(campaign, (tx) => {
    const id = randomUUID();
    tx.insert(knowledgeItems)
      .values({
        campaignId: campaign,
        id,
        kind: request.kind,
        fromText: request.from ?? "",
        toText: request.to ?? "",
        text: request.text ?? "",
        pos: nextKnowledgeItemPos(tx, campaign),
      })
      .run();
    bumpKnowledgeItemOrder(tx, campaign);
    return renderKnowledgeItem(requireKnowledgeItemRow(tx, campaign, id));
  });
}

/**
 * The body of an item PATCH, checked against the item's schema: the guard,
 * `force` and any subset of the fields — a key that is none of these, or a
 * value of the wrong shape, is a 400 that names it.
 */
export function readKnowledgeItemPatch(raw: unknown): KnowledgeItemPatch {
  return parseRequest(knowledgeItemPatchSchema, raw, "knowledge item patch");
}

/**
 * PATCH /api/campaigns/:campaign/knowledge-items/:id — any subset of the
 * item's fields in one row update against one `rev`. A patch that names no
 * field is 400 `nothing_to_write`; the id may be echoed, never changed. The
 * order does not move.
 *
 * A stale `rev` is 409 with the current item under `knowledgeItem`; `force`
 * writes the given fields on top of it instead. An unknown id is 404.
 */
export async function patchKnowledgeItem(
  campaign: string,
  id: string,
  patch: KnowledgeItemPatch,
): Promise<KnowledgeItem> {
  const { rev, force, id: patchedId, ...fields } = patch;
  if (!Object.values(fields).some((value) => value !== undefined) && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const row = requireKnowledgeItemRow(tx, campaign, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "knowledge item changed", {
        knowledgeItem: renderKnowledgeItem(row),
      });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    const next: KnowledgeItemRow = {
      ...row,
      kind: fields.kind ?? row.kind,
      fromText: fields.from ?? row.fromText,
      toText: fields.to ?? row.toText,
      text: fields.text ?? row.text,
      rev: row.rev + 1,
    };
    tx.update(knowledgeItems)
      .set({
        kind: next.kind,
        fromText: next.fromText,
        toText: next.toText,
        text: next.text,
        rev: next.rev,
      })
      .where(and(eq(knowledgeItems.campaignId, campaign), eq(knowledgeItems.id, row.id)))
      .run();
    return renderKnowledgeItem(next);
  });
}

/** The body of an item DELETE: the guard the item was read with. */
export function readKnowledgeItemDelete(raw: unknown): KnowledgeItemDelete {
  return parseRequest(knowledgeItemDeleteSchema, raw, "knowledge item delete");
}

/**
 * DELETE /api/campaigns/:campaign/knowledge-items/:id `{ rev }` — remove one
 * item; the order loses it. A stale `rev` is 409 with the current item under
 * `knowledgeItem` and removes nothing; an unknown id is 404.
 */
export async function deleteKnowledgeItem(
  campaign: string,
  id: string,
  request: KnowledgeItemDelete,
): Promise<void> {
  await mutate(campaign, (tx) => {
    const row = requireKnowledgeItemRow(tx, campaign, id);
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "knowledge item changed", {
        knowledgeItem: renderKnowledgeItem(row),
      });
    }
    tx.delete(knowledgeItems)
      .where(and(eq(knowledgeItems.campaignId, campaign), eq(knowledgeItems.id, row.id)))
      .run();
    bumpKnowledgeItemOrder(tx, campaign);
  });
}

/** The one past the highest `pos` of the campaign — where a new item stands. */
function nextKnowledgeItemPos(tx: GrimoireDb, campaign: string): number {
  return nextPos(
    tx
      .select({ pos: knowledgeItems.pos })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.campaignId, campaign))
      .all(),
  );
}

// --- the order ----------------------------------------------------------------

/** The order as it stands in a transaction: every item id, and its guard. */
function knowledgeItemOrderOf(tx: GrimoireDb, campaign: string): KnowledgeItemOrder {
  return {
    items: knowledgeItemRows(tx, campaign).map((row) => row.id),
    rev: requireCampaignRow(tx, campaign).knowledgeItemOrderRev,
  };
}

/** GET /api/campaigns/:campaign/knowledge-item-order */
export async function readKnowledgeItemOrder(campaign: string): Promise<KnowledgeItemOrder> {
  await requireCampaign(campaign);
  return knowledgeItemOrderOf(await getDb(), campaign);
}

/** The body of an order PUT, checked against the order's schema. */
export function readKnowledgeItemOrderRequest(raw: unknown): KnowledgeItemOrder {
  return parseRequest(knowledgeItemOrderSchema, raw, "knowledge item order");
}

/**
 * PUT /api/campaigns/:campaign/knowledge-item-order `{ items, rev }` — the
 * whole order in one request: moving one item changes where its neighbours
 * stand too, so the array IS the order.
 *
 * THE GUARD IS `campaigns.knowledge_item_order_rev`, and the write bumps only
 * that one: no item's `rev` and not the campaign's own `rev` moves, so an
 * item open in an editor is no conflict because the list around it was
 * rearranged. A stale guard is 409 with the current order under
 * `knowledgeItemOrder` and writes nothing.
 *
 * `items` has to name EXACTLY the campaign's items, each once — anything else
 * is a 400 that says what is off, and nothing is written: a partial order
 * would have to invent positions for the items it leaves out.
 */
export async function writeKnowledgeItemOrder(
  campaign: string,
  request: KnowledgeItemOrder,
): Promise<KnowledgeItemOrder> {
  return mutate(campaign, (tx) => {
    const current = knowledgeItemOrderOf(tx, campaign);
    if (current.rev !== request.rev) {
      throw revConflict(current.rev, "knowledge item order changed", {
        knowledgeItemOrder: current,
      });
    }
    const present = new Set(current.items);
    const named = new Set(request.items);
    if (
      named.size !== request.items.length ||
      named.size !== present.size ||
      request.items.some((id) => !present.has(id))
    ) {
      throw new ApiError(
        400,
        "the order must name every knowledge item of the campaign exactly once",
      );
    }
    request.items.forEach((id, pos) => {
      tx.update(knowledgeItems)
        .set({ pos })
        .where(and(eq(knowledgeItems.campaignId, campaign), eq(knowledgeItems.id, id)))
        .run();
    });
    return { items: [...request.items], rev: bumpKnowledgeItemOrder(tx, campaign) };
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * An item without its guard — a fixture — checked against the item's schema.
 * A key an item does not have, or a value of the wrong shape, is refused with
 * the message `what` introduces.
 */
export function readKnowledgeItemSeed(raw: unknown, what: string): KnowledgeItemSeed {
  return parseRequest(knowledgeItemSeedSchema, raw, what);
}

/** Write one item of a fixture, at the end, INSIDE the caller's transaction. */
export function insertKnowledgeItemSeed(tx: GrimoireDb, campaign: string, seed: KnowledgeItemSeed): void {
  tx.insert(knowledgeItems)
    .values({
      campaignId: campaign,
      id: seed.id,
      kind: seed.kind,
      fromText: seed.from,
      toText: seed.to,
      text: seed.text,
      pos: nextKnowledgeItemPos(tx, campaign),
    })
    .run();
}

// --- the prompt block ---------------------------------------------------------

/**
 * The KNOWLEDGE lines of the prompt — the items the generator puts above the
 * glossary, in their order, one line per item:
 *
 *     - Namenskonvention: schreibe „Alt“ immer als „Neu“.
 *     - Fakt: <Satz>
 *     - Stilregel: <Satz>
 *
 * German, like the rest of the prompt (llm-provider.ts: the pipeline's target
 * language is German) — this is prompt CONTENT, not UI copy, so it does not
 * belong in the app's catalog.
 *
 * `[[slug]]` references are RESOLVED here with the same expansion the
 * search index uses (store/refs.ts): a fact written as „[[fenn]] lügt immer“
 * must reach the model as „Fenn lügt immer“ — the model has never seen a
 * slug table and would otherwise copy the brackets into the prose.
 *
 * `undefined` when the campaign has no knowledge at all, so the prompt keeps
 * the exact shape it has without it.
 */
export async function knowledgeText(campaign: string): Promise<string | undefined> {
  const db = await getDb();
  const lines: string[] = [];
  for (const item of knowledgeItemRows(db, campaign).map(renderKnowledgeItem)) {
    const resolve = (value: string): string =>
      promptInline(expandCampaignBodyRefs(db, campaign, value));
    if (item.kind === "naming") {
      if (item.from.trim() === "" || item.to.trim() === "") continue;
      lines.push(
        `- Namenskonvention: schreibe „${resolve(item.from)}“ immer als „${resolve(item.to)}“.`,
      );
      continue;
    }
    if (item.text.trim() === "") continue;
    const label = item.kind === "fact" ? "Fakt" : "Stilregel";
    lines.push(`- ${label}: ${resolve(item.text)}`);
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

/**
 * The naming conventions as `from`/`to` pairs — the input of the post-run
 * check (naming-check.ts).
 *
 * REF-EXPANDED like the prompt lines: a rule written as
 * „[[fenn]]“ → „Fennwyn“ reaches the model as „Fenn“ → „Fennwyn“, so the
 * check has to search the drafts for „Fenn“ too — searching for the literal
 * „[[fenn]]“ would silently never match and make the rule look obeyed. Both
 * sides are expanded, because `to` is what the check uses to recognise the
 * already-correct spelling (naming-check.ts findRuleHits).
 */
export async function namingRules(campaign: string): Promise<Array<{ from: string; to: string }>> {
  const db = await getDb();
  const expand = (value: string): string =>
    promptInline(expandCampaignBodyRefs(db, campaign, value)).trim();
  return knowledgeItemRows(db, campaign)
    .map(renderKnowledgeItem)
    .filter((item) => item.kind === "naming" && item.from.trim() !== "" && item.to.trim() !== "")
    .map((item) => ({ from: expand(item.from), to: expand(item.to) }))
    .filter((rule) => rule.from !== "" && rule.to !== "");
}

/**
 * One stored item as it may appear INSIDE a prompt line.
 *
 * The items are assembled into a markdown prompt, so an item is a fragment
 * the model reads as instructions. The endpoints already refuse newlines in a
 * knowledge item (routes/knowledge-items.ts), and this is the second half of
 * that: whatever is in the database — a row from an older build, a hand-made
 * one, a glossary explanation that spans lines — can only ever become ONE
 * line of text here.
 *
 *   * all whitespace collapses to single spaces, so no item can open a line
 *     of its own;
 *   * a leading „#“ is escaped to „\#“, so no item can become a HEADING and
 *     pose as a section of the prompt („## Kampagnenwissen“ is the section
 *     the prompt itself writes, and it is binding).
 *
 * Defensive, not decorative: the DM is the only author, but the source text
 * they paste in is not theirs, and an item is the one place where foreign
 * text is quoted into the instruction half of the prompt.
 */
export function promptInline(value: string): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.startsWith("#") ? `\\${flat}` : flat;
}
