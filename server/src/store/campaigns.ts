// Campaigns: the row every other read and write starts from.
//
// The lookup that turns a campaign id into a row (404 for an unknown one),
// the list the app opens with, the create endpoint, and `campaigns.version` —
// the counter `GET /version` answers. `mutate` lives here too, because every
// write of this store is one transaction that bumps exactly that counter.

import { asc, eq, sql } from "drizzle-orm";
import { freeSlug, type CampaignSummary } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeCampaignId } from "../addressing";
import type { GrimoireDb } from "../db/client";
import { campaigns, sessions } from "../db/schema";
import { indexEntity } from "./fts";
import { getDb } from "./handle";
import { CAMPAIGN_PATH } from "./paths";
import { expandBodyRefs } from "./refs";
import { campaignDisplayName, type CampaignRow } from "./render";
import { compareSessionsNewestFirst, resolveNewId, slugTaken } from "./shared";

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

/** Current version counter of a campaign (`GET /version`, DECISIONS #9). */
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

// The campaign entry is not referenceable either — but its note body CONTAINS
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
 * unnamed campaign is shown under its id. This list and `GET /entries/
 * campaign` agree on that: both go through `campaignDisplayName`.
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
 * POST /api/campaigns { name, description? } -> CampaignSummary.
 *
 * The one create that cannot go through `mutate`: there is no campaign yet, so
 * there is no `version` to bump — the row starts at the column defaults, and
 * its own first version IS the change.
 *
 * A campaign id has NO reserved names, and that was checked rather than
 * assumed: `RESERVED_SEGMENTS` reserves first segments INSIDE a campaign, and
 * the api mounts no `/:campaign` route that a literal (`/api/campaigns`) could
 * be shadowed by — `/api/campaigns/tree` is the campaign `campaigns`, `GET
 * /api/campaigns` is the list, and both keep working. What is refused is an id
 * that is no id: an empty one, one a name yields nothing for, or an explicit
 * one that is no slug (`resolveNewId`), plus the path-safety rules
 * (`assertSafeCampaignId`).
 */
export async function createCampaign(
  name: string,
  description?: string,
  explicitId?: string,
): Promise<CampaignSummary> {
  const id = resolveNewId(explicitId, name, "campaign", "name");
  assertSafeCampaignId(id);
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    if (campaignRow(tx, id) !== undefined) {
      const suggestion = freeSlug(id, (candidate) => campaignRow(tx, candidate) !== undefined);
      // `path` in this 409 is an ADDRESS the app can link to, and a campaign id
      // alone is not one. The entry that always exists — even for a campaign
      // that holds nothing else — is the campaign row itself (`campaign`), so
      // that is what is pointed at. It carries the campaign id as its first
      // segment because a campaign collision has no campaign scope to be
      // relative to, unlike every other create endpoint of the store.
      throw slugTaken("campaign", id, suggestion, `${id}/${CAMPAIGN_PATH}`);
    }
    // `name === id` is stored as "" — the empty name means "fall back to the
    // id" everywhere it is rendered (./render), exactly as `patchEntry`
    // stores it (./entries.ts), so the round trip agrees.
    tx.insert(campaigns)
      .values({
        id,
        name: name.trim() === id ? "" : name.trim(),
        description: description === undefined || description.trim() === "" ? null : description.trim(),
      })
      .run();
    const row = campaignRow(tx, id);
    if (row === undefined) throw new ApiError(500, "campaign could not be created");
    indexCampaign(tx, row);
    const summary: CampaignSummary = { id: row.id, name: campaignDisplayName(row) };
    if (row.description !== null && row.description.trim() !== "") {
      summary.description = row.description;
    }
    return summary;
  }) as CampaignSummary;
}
