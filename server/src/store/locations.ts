// Locations: the location resource read, listed, written, created and taken
// over from a proposal — all of it typed by the location's one zod schema
// (decisions/resources, @grimoire/shared/location). A row renders into a `Location`, and
// a `LocationPatch` or a `LocationProposal` writes into a row.
//
// A location is the group a scene hangs in (decisions/scene-order), so its id is a
// reference key long before the location holds anything. Creating one
// therefore fills a location the DM created and left empty rather than
// colliding with it — the same rule an npc follows (./npcs.ts), decided over
// the columns a location actually has.

import { and, asc, eq } from "drizzle-orm";
import {
  freeSlug,
  locationPatchSchema,
  locationProposalSchema,
  type Location,
  type LocationPatch,
  type LocationProposal,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { generateJobs, locations } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { assertChapterRef } from "./chapters";
import { indexEntity } from "./fts";
import { getDb } from "./handle";
import { expandCampaignBodyRefs } from "./refs";
import type { LocationRow } from "./render";
import { indexedProse, reindexReferrers } from "./search-index";
import { normalizeBody, parseRequest, resolveNewId, revConflict, slugTaken, unknownRef } from "./shared";

// --- rendering a row ----------------------------------------------------------

/**
 * The location of a row. An empty name falls back to the id — the same
 * display-name rule as everywhere — and a column that holds nothing is a field
 * the location does not carry.
 */
export function renderLocation(row: LocationRow): Location {
  return {
    id: row.id,
    name: row.name === "" ? row.id : row.name,
    ...(row.chapterId === null ? {} : { chapter: row.chapterId }),
    ...(row.roll20Page === null ? {} : { roll20Page: row.roll20Page }),
    ...(row.atmosphere === null ? {} : { atmosphere: row.atmosphere }),
    body: row.body,
    rev: row.rev,
  };
}

// --- a location that holds nothing but its id ---------------------------------

export function isEmptyLocationRow(row: LocationRow): boolean {
  return (
    row.name === "" &&
    row.chapterId === null &&
    row.roll20Page === null &&
    row.atmosphere === null &&
    row.body.trim() === ""
  );
}

// --- reading ------------------------------------------------------------------

/** One location, inside a handle; 404 when the campaign has none with that id. */
export function locationIn(tx: GrimoireDb, campaign: string, id: string): Location {
  const row = locationRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "location not found");
  return renderLocation(row);
}

/** GET /api/campaigns/:campaign/locations/:id */
export async function readLocation(campaign: string, id: string): Promise<Location> {
  await requireCampaign(campaign);
  return locationIn(await getDb(), campaign, id);
}

/** GET /api/campaigns/:campaign/locations — every location, by name. */
export async function listLocations(campaign: string): Promise<Location[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  const rows = db
    .select()
    .from(locations)
    .where(eq(locations.campaignId, campaign))
    .orderBy(asc(locations.id))
    .all() as LocationRow[];
  return rows
    .map(renderLocation)
    .sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

// --- writing ------------------------------------------------------------------

/**
 * The body of a location PATCH, checked against the location's schema: the
 * guard, `force` and any subset of the fields, `body` among them — a key that
 * is none of these, or a value of the wrong shape, is a 400 that names it.
 */
export function readLocationPatch(raw: unknown): LocationPatch {
  return parseRequest(locationPatchSchema, raw, "location patch");
}

/**
 * PATCH /api/campaigns/:campaign/locations/:id — THE write of one location
 * (decisions/writes): any subset of its fields in one row update against one `rev`.
 *
 * `jobId` discards the generator job the write came from — an accepted
 * augment proposal — in the SAME transaction. A stale id matches nothing and
 * is ignored.
 */
export async function patchLocation(
  campaign: string,
  id: string,
  raw: unknown,
  jobId?: string,
): Promise<Location> {
  const patch = readLocationPatch(raw);
  return mutate(campaign, (tx) => {
    const written = patchLocationIn(tx, campaign, id, patch);
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
 * never changes (decisions/constraints): a patch may echo it, never alter it. A patch that
 * names no field is a 400 `nothing_to_write`.
 */
export function patchLocationIn(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  patch: LocationPatch,
): Location {
  const { rev, force, id: patchedId, ...fields } = patch;
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  const row = locationRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "location not found");
  const guard = force === true ? row.rev : rev;
  if (row.rev !== guard) {
    throw revConflict(row.rev, "location changed", { location: renderLocation(row) });
  }
  if (patchedId !== undefined && patchedId !== row.id) {
    throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
  }
  const next: LocationRow = {
    ...row,
    name: fields.name ?? row.name,
    chapterId: fields.chapter === undefined ? row.chapterId : fields.chapter,
    roll20Page: fields.roll20Page === undefined ? row.roll20Page : fields.roll20Page,
    atmosphere: fields.atmosphere === undefined ? row.atmosphere : fields.atmosphere,
    body: fields.body === undefined ? row.body : normalizeBody(fields.body),
    rev: row.rev + 1,
  };
  assertChapterRef(tx, campaign, next.chapterId);
  tx.update(locations)
    .set({
      name: next.name,
      chapterId: next.chapterId,
      roll20Page: next.roll20Page,
      atmosphere: next.atmosphere,
      body: next.body,
      rev: next.rev,
    })
    .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
    .run();
  indexLocation(tx, campaign, next);
  return renderLocation(next);
}

// --- taking over a proposal ---------------------------------------------------

/**
 * A location without its guard — a fixture or a generator proposal — checked
 * against the location's schema. A key a location does not have, or a value
 * of the wrong shape, is refused with the message `what` introduces.
 */
export function readLocationProposal(raw: unknown, what: string): LocationProposal {
  return parseRequest(locationProposalSchema, raw, what);
}

/**
 * Write one location proposal into the campaign, INSIDE the caller's
 * transaction — the seed and the generator's accept both end here. The
 * caller has checked for conflicts: a location the DM created and left empty
 * is FILLED rather than collided with (see `isEmptyLocationRow`).
 */
export function insertLocationProposal(
  tx: GrimoireDb,
  campaign: string,
  proposal: LocationProposal,
): void {
  assertChapterRef(tx, campaign, proposal.chapter ?? null);
  const values = {
    name: proposal.name,
    chapterId: proposal.chapter ?? null,
    roll20Page: proposal.roll20Page ?? null,
    atmosphere: proposal.atmosphere ?? null,
    body: proposal.body,
  };
  const existing = locationRowOf(tx, campaign, proposal.id);
  if (existing !== undefined) {
    tx.update(locations)
      .set({ ...values, rev: existing.rev + 1 })
      .where(and(eq(locations.campaignId, campaign), eq(locations.id, proposal.id)))
      .run();
  } else {
    tx.insert(locations)
      .values({ campaignId: campaign, id: proposal.id, ...values })
      .run();
  }
  const row = locationRowOf(tx, campaign, proposal.id);
  if (row !== undefined) indexLocation(tx, campaign, row);
}

/** True when a proposal would land on a location that already holds something. */
export function locationTaken(tx: GrimoireDb, campaign: string, id: string): boolean {
  const row = locationRowOf(tx, campaign, id);
  return row !== undefined && !isEmptyLocationRow(row);
}

// --- creating a location ------------------------------------------------------

/** POST /api/campaigns/:campaign/locations { name, id? } -> the location. */
export async function createLocation(
  campaign: string,
  name: string,
  explicitId?: string,
): Promise<Location> {
  const id = resolveNewId(explicitId, name, "location", "name");
  return mutate(campaign, (tx) => {
    const existing = locationRowOf(tx, campaign, id);
    if (existing !== undefined && !isEmptyLocationRow(existing)) {
      // Same as for an npc: an empty location is claimed, so it is never proposed.
      const suggestion = freeSlug(
        id,
        (candidate) => locationRowOf(tx, campaign, candidate) !== undefined,
      );
      throw slugTaken("location", id, suggestion);
    }
    const stored = name.trim() === id ? "" : name.trim();
    if (existing === undefined) {
      tx.insert(locations).values({ campaignId: campaign, id, name: stored }).run();
    } else {
      tx.update(locations)
        .set({ name: stored, rev: existing.rev + 1 })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
        .run();
    }
    const row = locationRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "location could not be created");
    indexLocation(tx, campaign, row);
    return renderLocation(row);
  });
}

// --- loading and checking a location row ---------------------------------------

/** One location row by id, read through `tx` (the database or a transaction). */
export function locationRowOf(tx: GrimoireDb, campaign: string, id: string): LocationRow | undefined {
  return tx
    .select()
    .from(locations)
    .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
    .all()[0] as LocationRow | undefined;
}

/** A scene's `location` has to name a location. */
export function assertLocationRef(tx: GrimoireDb, campaign: string, id: string | null): void {
  if (id === null) return;
  if (locationRowOf(tx, campaign, id) !== undefined) return;
  throw unknownRef("location_unknown", "location", id);
}

/** Rebuild a location's search-index row, then the rows of what references it. */
export function indexLocation(tx: GrimoireDb, campaign: string, row: LocationRow): void {
  indexEntity(tx, campaign, {
    kind: "location",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: expandCampaignBodyRefs(tx, campaign, indexedProse(row.atmosphere, row.body)),
  });
  reindexReferrers(tx, campaign, row.id);
}
