// Campaigns: the campaign resource, and the row every other read and write
// starts from.
//
// The campaign is its own resource with its own type (decisions/resources,
// @grimoire/shared/campaign): read, written, created and seeded here, typed
// by its one zod schema. Beside it stand the lookup that turns a campaign id
// into a row (404 for an unknown one), the list the app opens with, and
// `campaigns.version` — the counter `GET /version` answers. `mutate` lives
// here too, because every write of this store is one transaction that bumps
// exactly that counter.

import { asc, eq, sql } from "drizzle-orm";
import {
  campaignPatchSchema,
  campaignSeedSchema,
  freeSlug,
  type Campaign,
  type CampaignPatch,
  type CampaignSeed,
  type CampaignSummary,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeCampaignId } from "../addressing";
import type { GrimoireDb } from "../db/client";
import { campaigns, sessions } from "../db/schema";
import { indexEntity } from "./fts";
import { getDb } from "./handle";
import { expandBodyRefs } from "./refs";
import type { CampaignRow } from "./render";
import { compareSessionsNewestFirst } from "./session-rows";
import {
  normalizeBody,
  parseRequest,
  resolveNewId,
  revConflict,
  slugTaken,
} from "./shared";

// --- campaign lookup ---------------------------------------------------------

/**
 * The campaign row; 400 for an unsafe id, 404 when it does not exist. Every
 * endpoint starts with it, so an unknown campaign answers 404 before anything
 * else is read.
 */
export async function requireCampaign(id: string): Promise<CampaignRow> {
  assertSafeCampaignId(id);
  const db = await getDb();
  const row = campaignRow(db, id);
  if (row === undefined) throw new ApiError(404, "campaign not found");
  return row;
}

export function campaignRow(db: GrimoireDb, id: string): CampaignRow | undefined {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).all()[0] as
    | CampaignRow
    | undefined;
}

/** Current version counter of a campaign (`GET /version`, decisions/polling). */
export async function campaignVersion(id: string): Promise<number> {
  return (await requireCampaign(id)).version;
}

/**
 * The campaign row inside a running transaction. `mutate` has already proved
 * the campaign exists, so this only narrows the type — a 404 here would mean
 * the row vanished between two statements of one transaction.
 */
export function requireCampaignRow(tx: GrimoireDb, campaign: string): CampaignRow {
  const row = campaignRow(tx, campaign);
  if (row === undefined) throw new ApiError(404, "campaign not found");
  return row;
}

// --- rendering a row ----------------------------------------------------------

/**
 * The campaign's display name: its stored name, or the id when there is none.
 *
 * `""` in the column means "no authored name" — a campaign created without
 * one, or seeded without one. The fallback to the id is applied HERE, once,
 * and everything that shows a campaign name reads it through this function:
 * the campaign (`GET /campaigns/:c`) and the campaign list (`GET /campaigns`)
 * must agree about it.
 */
export function campaignDisplayName(row: CampaignRow): string {
  return row.name === "" ? row.id : row.name;
}

/**
 * The campaign of a row. A description that holds nothing is a field the
 * campaign does not carry; the body travels exactly as it is stored.
 */
export function renderCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: campaignDisplayName(row),
    ...(row.description === null ? {} : { description: row.description }),
    body: row.body,
    glossaryIntro: row.glossaryIntro,
    rev: row.rev,
  };
}

// --- reading ------------------------------------------------------------------

/** GET /api/campaigns/:campaign */
export async function readCampaign(campaign: string): Promise<Campaign> {
  return renderCampaign(await requireCampaign(campaign));
}

// --- writing ------------------------------------------------------------------

/**
 * The stored form of a name: a name that EQUALS the id is stored as "" — the
 * empty name means "fall back to the id" everywhere it is rendered
 * (`campaignDisplayName`), so the round trip shows the same name back and the
 * row carries no redundant copy of its own key.
 */
function storedName(name: string, id: string): string {
  return name === id ? "" : name;
}

/**
 * PATCH /api/campaigns/:campaign — THE write of the campaign (decisions/writes): any
 * subset of its fields, checked against the campaign's schema — a key that
 * is none of them, or a value of the wrong shape, is a 400 that names it —
 * in ONE row update against ONE `rev`.
 *
 * Only the fields the patch names are touched; `null` clears the
 * description, and the glossary intro is stored like the body. `force` replaces the guard by the row's current rev — the DM's
 * answer to the conflict dialog, which writes only what this request
 * carries. The id may be echoed, never changed (decisions/constraints). A patch that names
 * no field is a 400 `nothing_to_write`.
 */
export async function patchCampaign(campaign: string, raw: unknown): Promise<Campaign> {
  const patch: CampaignPatch = parseRequest(campaignPatchSchema, raw, "campaign patch");
  const { rev, force, id: patchedId, ...fields } = patch;
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const row = requireCampaignRow(tx, campaign);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "campaign changed", { campaign: renderCampaign(row) });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    const next: CampaignRow = {
      ...row,
      name: fields.name === undefined ? row.name : storedName(fields.name, row.id),
      description: fields.description === undefined ? row.description : fields.description,
      body: fields.body === undefined ? row.body : normalizeBody(fields.body),
      glossaryIntro:
        fields.glossaryIntro === undefined ? row.glossaryIntro : normalizeBody(fields.glossaryIntro),
      rev: row.rev + 1,
    };
    tx.update(campaigns)
      .set({
        name: next.name,
        description: next.description,
        body: next.body,
        glossaryIntro: next.glossaryIntro,
        rev: next.rev,
      })
      .where(eq(campaigns.id, campaign))
      .run();
    indexCampaign(tx, next);
    return renderCampaign(next);
  });
}

// --- transaction plumbing ----------------------------------------------------

/**
 * Run `fn` in one transaction and bump the campaign's version counter in the
 * same commit. The driver is synchronous (db/driver.ts), so `fn` must be too
 * — no `await` may happen inside a transaction.
 */
export async function mutate<T>(campaign: string, fn: (db: GrimoireDb) => T): Promise<T> {
  await requireCampaign(campaign);
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const result = fn(tx);
    tx.update(campaigns)
      .set({ version: sql`${campaigns.version} + 1` })
      .where(eq(campaigns.id, campaign))
      .run();
    return result;
  }) as T;
}

// --- the search index row of a campaign --------------------------------------

// The campaign is not referenceable — but its note body CONTAINS
// references like any other, and store/refs.ts scans it for them, so nothing
// here is half-supported.
export function indexCampaign(tx: GrimoireDb, row: CampaignRow): void {
  indexEntity(tx, row.id, {
    kind: "campaign",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, row.id, row.body),
  });
}

// --- GET /api/campaigns ------------------------------------------------------

/**
 * All campaigns with `name`/`description` plus the newest session's id
 * (`lastSession`) and its `started` (`lastSessionStarted`) — which is what
 * lets the app re-open the last active campaign. "Newest" is
 * `compareSessionsNewestFirst`: `started`, then the row's insertion order.
 *
 * The `started` value travels because the id CANNOT be ordered by the client:
 * it is opaque (db/schema.ts). Sorting campaigns by the id string would be
 * sorting random noise.
 *
 * `name` is the campaign's DISPLAY name and therefore always there: an
 * unnamed campaign is shown under its id. This list and `GET /campaigns/:c`
 * agree on that: both go through `campaignDisplayName`.
 */
export async function listCampaigns(): Promise<CampaignSummary[]> {
  const db = await getDb();
  const rows = db.select().from(campaigns).orderBy(asc(campaigns.id)).all() as CampaignRow[];
  return rows.map((row) => {
    const summary: CampaignSummary = { id: row.id, name: campaignDisplayName(row) };
    if (row.description !== null && row.description.trim() !== "") {
      summary.description = row.description;
    }
    // Not `max(id)`: session ids are opaque random strings, so
    // there is no order in them at all. The sort needs exactly the three
    // columns `compareSessionsNewestFirst` reads, so the list must NOT pull
    // whole session rows — a campaign with 80 evenings would drag 80 log
    // bodies through this loop for one id.
    const newest = db
      .select({ id: sessions.id, started: sessions.started, createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.campaignId, row.id))
      .all()
      .sort(compareSessionsNewestFirst)[0];
    if (newest !== undefined) {
      summary.lastSession = newest.id;
      if (newest.started !== null && newest.started.trim() !== "") {
        summary.lastSessionStarted = newest.started;
      }
    }
    return summary;
  });
}

/**
 * POST /api/campaigns { name, description?, id? } -> the campaign. `name`
 * and `description` arrive trimmed, a blank description as none.
 *
 * The one create that cannot go through `mutate`: there is no campaign yet, so
 * there is no `version` to bump — the row starts at the column defaults, and
 * its own first version IS the change.
 *
 * A campaign id has NO reserved names: every campaign route spells
 * `/campaigns/:campaign/…`, and the one literal beside them is the list
 * (`GET /api/campaigns`), so a campaign called `tree` is read at
 * `/api/campaigns/tree` and its tree at `/api/campaigns/tree/tree`. What is
 * refused is an id that is no id: an empty one, one a name yields nothing
 * for, or an explicit one that is no slug (`resolveNewId`), plus the
 * path-safety rules (`assertSafeCampaignId`).
 */
export async function createCampaign(
  name: string,
  description?: string,
  explicitId?: string,
): Promise<Campaign> {
  const id = resolveNewId(explicitId, name, "campaign", "name");
  assertSafeCampaignId(id);
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    if (campaignRow(tx, id) !== undefined) {
      const suggestion = freeSlug(id, (candidate) => campaignRow(tx, candidate) !== undefined);
      throw slugTaken("campaign", id, suggestion);
    }
    tx.insert(campaigns)
      .values({ id, name: storedName(name, id), description: description ?? null })
      .run();
    const row = campaignRow(tx, id);
    if (row === undefined) throw new ApiError(500, "campaign could not be created");
    indexCampaign(tx, row);
    return renderCampaign(row);
  }) as Campaign;
}

// --- seeding a campaign ---------------------------------------------------------

/**
 * A campaign without its guard — a fixture — checked against the campaign's
 * schema. A key a campaign does not have, or a value of the wrong shape, is
 * refused with the message `what` introduces.
 */
export function readCampaignSeed(raw: unknown, what: string): CampaignSeed {
  return parseRequest(campaignSeedSchema, raw, what);
}

/**
 * Write one campaign row from its fixture, INSIDE the caller's transaction —
 * the seed's first write, which every other row hangs off.
 */
export function insertCampaignSeed(tx: GrimoireDb, seed: CampaignSeed): void {
  tx.insert(campaigns)
    .values({
      id: seed.id,
      name: storedName(seed.name, seed.id),
      description: seed.description ?? null,
      body: seed.body,
      glossaryIntro: seed.glossaryIntro,
    })
    .run();
  const row = campaignRow(tx, seed.id);
  if (row !== undefined) indexCampaign(tx, row);
}
