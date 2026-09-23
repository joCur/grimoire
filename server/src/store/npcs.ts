// Npcs: creating an npc entry, and what "empty" means for one.
//
// Two doors bring an npc row into existence — the create dialog and the
// review's "#npc line becomes an npc" — and both fill an entry the DM created
// and left empty instead of colliding with it. That emptiness is defined
// here, because the generator's apply step and the create endpoint decide the
// same way.

import { and, eq } from "drizzle-orm";
import { ENTITY_SLUG, freeSlug, type EntryResponse } from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { npcs } from "../db/schema";
import { mutate } from "./campaigns";
import { indexNpc, npcRowOf } from "./entity-rows";
import { npcPath } from "./paths";
import { renderNpc, type NpcRow } from "./render";
import { resolveNewId, slugTaken } from "./shared";

/**
 * The `npcs.status` column default (schema.ts) — "nothing is claimed". Named
 * here because emptiness is defined against it (`isEmptyNpcRow`).
 */
export const NPC_DEFAULT_STATUS = "unknown";

// --- an entry that holds nothing but its id -----------------------------------

/**
 * An entry that holds NOTHING but its id — what a DM leaves behind by
 * creating an entry and not filling it in.
 *
 * The generator's apply step FILLS such an entry instead of answering the
 * documented `409 { conflicts }` for a target that has no content to lose,
 * and so does the npc-create action for that same id.
 *
 * `status` COUNTS as information. An entry the DM only ever set to `dead` is
 * still a statement about that npc — the one field the live view acts on — so
 * an apply must not overwrite it silently; it answers the documented 409 like
 * any other filled row. Only the column DEFAULT is emptiness.
 */
export function isEmptyNpcRow(row: NpcRow): boolean {
  return (
    row.name === "" &&
    row.status === NPC_DEFAULT_STATUS &&
    row.role === null &&
    row.chapterId === null &&
    row.statblock === null &&
    row.voice === null &&
    row.appearance === null &&
    row.motivation === null &&
    row.body.trim() === "" &&
    isEmptyJsonObject(row.quickstats)
  );
}

function isEmptyJsonObject(packed: string): boolean {
  const trimmed = packed.trim();
  return trimmed === "" || trimmed === "{}";
}

// --- reading an npc entry -----------------------------------------------------

/**
 * The npc entry an address names; 404 when the campaign has no npc with that
 * id.
 */
export function readNpcEntry(tx: GrimoireDb, campaign: string, id: string): EntryResponse {
  const row = npcRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  return renderNpc(row);
}

// --- creating an npc ----------------------------------------------------------

/**
 * POST /api/campaigns/:campaign/npcs { name } -> the npc entry. The three
 * rules every create endpoint follows are in store/shared.ts.
 */
export async function createNpc(
  campaign: string,
  name: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, name, "npc", "name");
  return mutate(campaign, (tx) => {
    const existing = npcRowOf(tx, campaign, id);
    if (existing !== undefined && !isEmptyNpcRow(existing)) {
      // Any existing row is taken for the PROPOSAL — an empty one too: the
      // DM created that id, so proposing it would hand them somebody else's
      // entry under a name they never typed (store/shared.ts, rule 2).
      const suggestion = freeSlug(id, (candidate) => npcRowOf(tx, campaign, candidate) !== undefined);
      throw slugTaken("npc", id, suggestion, npcPath(id));
    }
    const stored = name.trim() === id ? "" : name.trim();
    if (existing === undefined) {
      tx.insert(npcs).values({ campaignId: campaign, id, name: stored }).run();
    } else {
      // An entry the DM created and left empty — this call fills it.
      tx.update(npcs)
        .set({ name: stored, rev: existing.rev + 1 })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
        .run();
    }
    const row = npcRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "npc could not be created");
    indexNpc(tx, campaign, row);
    return renderNpc(row);
  });
}

/**
 * POST /api/campaigns/:campaign/review/npc-stub — the review's "#npc line becomes an
 * npc". This is one of the two ways an entry comes into existence, and it is
 * an explicit one: the DM clicks it on a log line. CREATE OR LINK — the
 * caller's goal is that this id has an entry afterwards, so it is idempotent.
 *
 *   * no row      -> create it with the given name and the log text under
 *                   `## Notizen`;
 *   * EMPTY row   -> fill it (the DM created it earlier and typed nothing,
 *                   and the review is the first thing that knows a name and
 *                   a note);
 *   * filled row  -> return it UNTOUCHED, so the app links to what is there.
 *                   Nothing is overwritten and nothing is refused: a
 *                   `409 { path }` here would make the DM correct an id that
 *                   was right.
 *
 * `status` keeps the column default ("unknown"): inserting "alive" would
 * contradict both the route's own documentation and the dialog text, and
 * claim something no log line ever said.
 */
export async function createNpcStub(
  campaign: string,
  id: string,
  name?: string,
  note?: string,
): Promise<EntryResponse> {
  if (!ENTITY_SLUG.test(id)) {
    throw new ApiError(400, "id must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  return mutate(campaign, (tx) => {
    // `## Notizen` is the app-managed review section (README) — always there
    // in a new entry, so later review notes have their place.
    const body = note === undefined ? "\n## Notizen\n" : `\n## Notizen\n\n- ${note}\n`;
    const existing = npcRowOf(tx, campaign, id);
    if (existing !== undefined) {
      if (!isEmptyNpcRow(existing)) return renderNpc(existing);
      tx.update(npcs)
        .set({ name: name ?? "", body, rev: existing.rev + 1 })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
        .run();
    } else {
      // `name: ""` means "the id is the name" (render.ts applies that
      // fallback once) — no redundant copy of the key in the row.
      tx.insert(npcs)
        .values({ campaignId: campaign, id, name: name ?? "", body })
        .run();
    }
    const row = npcRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "npc could not be created");
    indexNpc(tx, campaign, row);
    return renderNpc(row);
  });
}
