// Npcs: the npc resource read, listed, written, created and taken over from a
// proposal — all of it typed by the npc's one zod schema (ADR #31,
// @grimoire/shared/npc). A row renders into an `Npc`, and an `NpcPatch` or an
// `NpcProposal` writes into a row.
//
// An npc's id is a reference key long before the npc holds anything: a scene
// names it in its `npcs`, and the DM may create one and leave it empty.
// Creating one, a generator proposal and the review's "this note becomes an
// npc" therefore FILL an npc that holds nothing rather than colliding with it
// (`isEmptyNpcRow`), and answer 409 for one that holds something.

import { and, asc, eq } from "drizzle-orm";
import {
  freeSlug,
  npcPatchSchema,
  npcProposalSchema,
  type Npc,
  type NpcPatch,
  type NpcProposal,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { generateJobs, npcs, packJson, unpackJson } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { assertChapterRef, indexNpc, npcRowOf } from "./entity-rows";
import { getDb } from "./handle";
import type { NpcRow } from "./render";
import {
  assertNpcStatus,
  normalizeBody,
  parseRequest,
  resolveNewId,
  revConflict,
  slugTaken,
} from "./shared";

/**
 * The `npcs.status` column default (schema.ts) — "nothing is claimed". Named
 * here because emptiness is defined against it (`isEmptyNpcRow`).
 */
export const NPC_DEFAULT_STATUS = "unknown";

// --- rendering a row ----------------------------------------------------------

/**
 * The npc of a row. An empty name falls back to the id — the same
 * display-name rule as everywhere —, a column that holds nothing is a field
 * the npc does not carry, and an empty `quickstats` set is absent. The body
 * travels exactly as it is stored: nothing about an npc is derived from its
 * text (ADR #29).
 */
export function renderNpc(row: NpcRow): Npc {
  const quickstats = unpackJson(row.quickstats) as NonNullable<Npc["quickstats"]>;
  return {
    id: row.id,
    name: row.name === "" ? row.id : row.name,
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.chapterId === null ? {} : { chapter: row.chapterId }),
    status: (row.status === "" ? NPC_DEFAULT_STATUS : row.status) as Npc["status"],
    ...(row.statblock === null ? {} : { statblock: row.statblock }),
    ...(Object.keys(quickstats).length === 0 ? {} : { quickstats }),
    ...(row.voice === null ? {} : { voice: row.voice }),
    ...(row.appearance === null ? {} : { appearance: row.appearance }),
    ...(row.motivation === null ? {} : { motivation: row.motivation }),
    body: row.body,
    rev: row.rev,
  };
}

// --- an npc that holds nothing but its id -------------------------------------

/**
 * An npc that holds NOTHING but its id — what a DM leaves behind by creating
 * an npc and not filling it in.
 *
 * Creating that id again, a generator proposal for it and the review's note
 * FILL such an npc instead of answering 409 for a row that has no content to
 * lose.
 *
 * `status` COUNTS as information. An npc the DM only ever set to `dead` is
 * still a statement about it — the one field the live view acts on — so a
 * proposal must not overwrite it silently; it answers the 409 like any other
 * filled row. Only the column DEFAULT is emptiness.
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
    Object.keys(unpackJson(row.quickstats)).length === 0
  );
}

/** True when a proposal would land on an npc that already holds something. */
export function npcTaken(tx: GrimoireDb, campaign: string, id: string): boolean {
  const row = npcRowOf(tx, campaign, id);
  return row !== undefined && !isEmptyNpcRow(row);
}

/** The same question outside a transaction — an NPC run asks it before a job exists. */
export async function npcHoldsContent(campaign: string, id: string): Promise<boolean> {
  return npcTaken(await getDb(), campaign, id);
}

// --- reading ------------------------------------------------------------------

/** One npc, inside a handle; 404 when the campaign has none with that id. */
export function npcIn(tx: GrimoireDb, campaign: string, id: string): Npc {
  const row = npcRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "npc not found");
  return renderNpc(row);
}

/** GET /api/campaigns/:campaign/npcs/:id */
export async function readNpc(campaign: string, id: string): Promise<Npc> {
  await requireCampaign(campaign);
  return npcIn(await getDb(), campaign, id);
}

/** GET /api/campaigns/:campaign/npcs — every npc, by name. */
export async function listNpcs(campaign: string): Promise<Npc[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  const rows = db
    .select()
    .from(npcs)
    .where(eq(npcs.campaignId, campaign))
    .orderBy(asc(npcs.id))
    .all() as NpcRow[];
  return rows
    .map(renderNpc)
    .sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

// --- writing ------------------------------------------------------------------

/**
 * The body of an npc PATCH, checked against the npc's schema: the guard,
 * `force` and any subset of the fields, `body` among them — a key that is
 * none of these, or a value of the wrong shape, is a 400 that names it. A
 * `status` outside the four is answered first, with the code the app has a
 * sentence for (`status_not_allowed`, ADR #25).
 */
export function readNpcPatch(raw: unknown): NpcPatch {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    assertNpcStatus(raw as Record<string, unknown>);
  }
  return parseRequest(npcPatchSchema, raw, "npc patch");
}

/**
 * PATCH /api/campaigns/:campaign/npcs/:id — THE write of one npc (ADR #23):
 * any subset of its fields in one row update against one `rev`.
 *
 * `jobId` discards the generator job the write came from — an accepted
 * augment proposal — in the SAME transaction. A stale id matches nothing and
 * is ignored.
 */
export async function patchNpc(
  campaign: string,
  id: string,
  raw: unknown,
  jobId?: string,
): Promise<Npc> {
  const patch = readNpcPatch(raw);
  return mutate(campaign, (tx) => {
    const written = patchNpcIn(tx, campaign, id, patch);
    if (jobId !== undefined) {
      tx.delete(generateJobs)
        .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
        .run();
    }
    return written;
  });
}

/**
 * The write itself, INSIDE the caller's transaction.
 *
 * Only the fields the patch names are touched; `null` clears an optional
 * one. `force` replaces the guard by the row's current rev — the DM's answer
 * to the conflict dialog, which writes only what this request carries. A
 * `chapter` has to name a chapter that exists (400 otherwise), and the id
 * never changes (ADR #21): a patch may echo it, never alter it. A patch that
 * names no field is a 400 `nothing_to_write`.
 */
export function patchNpcIn(tx: GrimoireDb, campaign: string, id: string, patch: NpcPatch): Npc {
  const { rev, force, id: patchedId, ...fields } = patch;
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  const row = npcRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "npc not found");
  const guard = force === true ? row.rev : rev;
  if (row.rev !== guard) {
    throw revConflict(row.rev, "npc changed", { npc: renderNpc(row) });
  }
  if (patchedId !== undefined && patchedId !== row.id) {
    throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
  }
  const next: NpcRow = {
    ...row,
    name: fields.name ?? row.name,
    role: fields.role === undefined ? row.role : fields.role,
    chapterId: fields.chapter === undefined ? row.chapterId : fields.chapter,
    status: fields.status ?? row.status,
    statblock: fields.statblock === undefined ? row.statblock : fields.statblock,
    quickstats:
      fields.quickstats === undefined ? row.quickstats : packJson(fields.quickstats ?? {}),
    voice: fields.voice === undefined ? row.voice : fields.voice,
    appearance: fields.appearance === undefined ? row.appearance : fields.appearance,
    motivation: fields.motivation === undefined ? row.motivation : fields.motivation,
    body: fields.body === undefined ? row.body : normalizeBody(fields.body),
    rev: row.rev + 1,
  };
  assertChapterRef(tx, campaign, next.chapterId);
  tx.update(npcs)
    .set({
      name: next.name,
      role: next.role,
      chapterId: next.chapterId,
      status: next.status,
      statblock: next.statblock,
      quickstats: next.quickstats,
      voice: next.voice,
      appearance: next.appearance,
      motivation: next.motivation,
      body: next.body,
      rev: next.rev,
    })
    .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
    .run();
  indexNpc(tx, campaign, next);
  return renderNpc(next);
}

// --- taking over a proposal ---------------------------------------------------

/**
 * An npc without its guard — a fixture or a generator proposal — checked
 * against the npc's schema. A key an npc does not have, or a value of the
 * wrong shape, is refused with the message `what` introduces.
 */
export function readNpcProposal(raw: unknown, what: string): NpcProposal {
  return parseRequest(npcProposalSchema, raw, what);
}

/**
 * Write one npc proposal into the campaign, INSIDE the caller's transaction
 * — the seed and the generator's accept both end here. The caller has
 * checked for conflicts: an npc the DM created and left empty is FILLED
 * rather than collided with (see `isEmptyNpcRow`).
 */
export function insertNpcProposal(tx: GrimoireDb, campaign: string, proposal: NpcProposal): void {
  assertChapterRef(tx, campaign, proposal.chapter ?? null);
  const values = {
    name: proposal.name,
    role: proposal.role ?? null,
    chapterId: proposal.chapter ?? null,
    status: proposal.status,
    statblock: proposal.statblock ?? null,
    quickstats: packJson(proposal.quickstats ?? {}),
    voice: proposal.voice ?? null,
    appearance: proposal.appearance ?? null,
    motivation: proposal.motivation ?? null,
    body: proposal.body,
  };
  const existing = npcRowOf(tx, campaign, proposal.id);
  if (existing !== undefined) {
    tx.update(npcs)
      .set({ ...values, rev: existing.rev + 1 })
      .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, proposal.id)))
      .run();
  } else {
    tx.insert(npcs)
      .values({ campaignId: campaign, id: proposal.id, ...values })
      .run();
  }
  const row = npcRowOf(tx, campaign, proposal.id);
  if (row !== undefined) indexNpc(tx, campaign, row);
}

// --- creating an npc ----------------------------------------------------------

/**
 * POST /api/campaigns/:campaign/npcs { name, id?, body? } -> the npc. The
 * three rules every create endpoint follows are in store/shared.ts.
 *
 * `body` is the npc's markdown — the review's "this note becomes an npc"
 * sends the note there, and it is stored as it was typed, with its closing
 * newline. An npc the DM created and left empty is FILLED with the name and
 * the body; an npc that holds something is a 409 `slug_taken` with a free
 * proposal, and nothing is written. `status` keeps the column default
 * (`unknown`): nothing in a name or a note says whether the figure lives.
 */
export async function createNpc(
  campaign: string,
  name: string,
  explicitId?: string,
  body?: string,
): Promise<Npc> {
  const id = resolveNewId(explicitId, name, "npc", "name");
  const text = normalizeBody(body ?? "");
  return mutate(campaign, (tx) => {
    const existing = npcRowOf(tx, campaign, id);
    if (existing !== undefined && !isEmptyNpcRow(existing)) {
      // Any existing row is taken for the PROPOSAL — an empty one too: the
      // DM created that id, so proposing it would hand them somebody else's
      // npc under a name they never typed (store/shared.ts, rule 2).
      const suggestion = freeSlug(id, (candidate) => npcRowOf(tx, campaign, candidate) !== undefined);
      throw slugTaken("npc", id, suggestion);
    }
    // `name: ""` means "the id is the name" (`renderNpc` applies that
    // fallback once) — no redundant copy of the key in the row.
    const stored = name.trim() === id ? "" : name.trim();
    if (existing === undefined) {
      tx.insert(npcs).values({ campaignId: campaign, id, name: stored, body: text }).run();
    } else {
      tx.update(npcs)
        .set({ name: stored, body: text, rev: existing.rev + 1 })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
        .run();
    }
    const row = npcRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "npc could not be created");
    indexNpc(tx, campaign, row);
    return renderNpc(row);
  });
}
