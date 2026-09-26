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
//
// A location in the trash (decisions/trash) is there for nothing but its
// restore: every read here asks for live locations (`locationRowOf`), and
// only the trash's own paths and the id checks of a create see the rest
// (`storedLocationRowOf`). Its id stays taken, and it is never filled.

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import {
  freeSlug,
  locationPatchSchema,
  locationProposalSchema,
  type Location,
  type LocationDelete,
  type LocationPatch,
  type LocationProposal,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { generateJobs, locations } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { assertChapterRef, chapterBlocker, storedChapterRowOf } from "./chapters";
import { dropEntity, indexEntity } from "./fts";
import { getDb } from "./handle";
import { expandCampaignBodyRefs } from "./refs";
import type { LocationRow } from "./render";
import { liveScenesAtLocation } from "./scenes";
import { indexedProse, reindexReferrers } from "./search-index";
import {
  isRestore,
  normalizeBody,
  parseRequest,
  resolveNewId,
  restoreBlocked,
  revConflict,
  slugTaken,
  trashBlocked,
  trashMoment,
  unknownRef,
  type TrashBlocker,
} from "./shared";
import { deletedField } from "./time";

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
    ...deletedField(row.deletedAt),
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

/**
 * GET /api/campaigns/:campaign/locations[?deleted=true] — every live
 * location, by name. `deleted` lists the locations in the trash instead, the
 * latest to go there first.
 */
export async function listLocations(campaign: string, deleted = false): Promise<Location[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  if (deleted) {
    return (
      db
        .select()
        .from(locations)
        .where(and(eq(locations.campaignId, campaign), isNotNull(locations.deletedAt)))
        .orderBy(desc(locations.deletedAt), asc(locations.id))
        .all() as LocationRow[]
    ).map(renderLocation);
  }
  const rows = db
    .select()
    .from(locations)
    .where(and(eq(locations.campaignId, campaign), isNull(locations.deletedAt)))
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
 *
 * A location in the trash takes exactly one patch, `deletedMs: null`, which
 * restores it (`restoreLocationIn`); any other is a 404, as if it were not
 * there. On a live location `deletedMs: null` changes nothing.
 */
export function patchLocationIn(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  patch: LocationPatch,
): Location {
  const { rev, force, id: patchedId, deletedMs, ...fields } = patch;
  const row = storedLocationRowOf(tx, campaign, id);
  if (row?.deletedAt != null) {
    if (!isRestore(deletedMs, fields) || (patchedId !== undefined && patchedId !== id)) {
      throw new ApiError(404, "location not found");
    }
    return restoreLocationIn(tx, campaign, row, force === true ? row.rev : rev);
  }
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
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

// --- the trash ----------------------------------------------------------------

/** A location as the trash's refusals name it. */
function locationBlocker(row: { id: string; name: string }): TrashBlocker {
  return { kind: "location", id: row.id, name: row.name === "" ? row.id : row.name };
}

/**
 * DELETE /api/campaigns/:campaign/locations/:id `{ rev }` — the location goes
 * to the trash (decisions/trash): it keeps its id and its fields, and its
 * `rev` moves. It leaves the search index, and its name leaves the indexed
 * text of every row that mentions it. A location a live scene plays at stays
 * where it is: 409 `trash_blocked` with those scenes, and nothing is written.
 * A stale `rev` is 409 with the current location; a location that is not
 * there, or already in the trash, is 404.
 */
export async function trashLocation(
  campaign: string,
  id: string,
  request: LocationDelete,
): Promise<Location> {
  return mutate(campaign, (tx) => {
    const row = locationRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(404, "location not found");
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "location changed", { location: renderLocation(row) });
    }
    const blockers = liveScenesAtLocation(tx, campaign, row.id);
    if (blockers.length > 0) throw trashBlocked("location", row.id, blockers);
    const next: LocationRow = { ...row, deletedAt: trashMoment(), rev: row.rev + 1 };
    tx.update(locations)
      .set({ deletedAt: next.deletedAt, rev: next.rev })
      .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
      .run();
    dropEntity(tx, campaign, "location", row.id);
    reindexReferrers(tx, campaign, row.id);
    return renderLocation(next);
  });
}

/**
 * The restore of one location, INSIDE the caller's transaction, against
 * `guard`. A location whose chapter is in the trash would name a chapter that
 * is not there: 409 `restore_blocked` with that chapter, and nothing is
 * written.
 */
function restoreLocationIn(
  tx: GrimoireDb,
  campaign: string,
  row: LocationRow,
  guard: number,
): Location {
  if (row.rev !== guard) {
    throw revConflict(row.rev, "location changed", { location: renderLocation(row) });
  }
  const chapter =
    row.chapterId === null ? undefined : storedChapterRowOf(tx, campaign, row.chapterId);
  if (chapter !== undefined && chapter.deletedAt !== null) {
    throw restoreBlocked("location", row.id, [chapterBlocker(chapter)]);
  }
  const next: LocationRow = { ...row, deletedAt: null, rev: row.rev + 1 };
  tx.update(locations)
    .set({ deletedAt: null, rev: next.rev })
    .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
    .run();
  indexLocation(tx, campaign, next);
  return renderLocation(next);
}

/** The live locations of this chapter — what keeps it out of the trash. */
export function liveLocationsOfChapter(
  tx: GrimoireDb,
  campaign: string,
  chapter: string,
): TrashBlocker[] {
  return tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(
      and(
        eq(locations.campaignId, campaign),
        eq(locations.chapterId, chapter),
        isNull(locations.deletedAt),
      ),
    )
    .orderBy(asc(locations.id))
    .all()
    .map(locationBlocker);
}

/** Those of these locations that are in the trash — what keeps a scene there. */
export function trashedLocationBlockers(
  tx: GrimoireDb,
  campaign: string,
  ids: readonly string[],
): TrashBlocker[] {
  if (ids.length === 0) return [];
  return tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(
      and(
        eq(locations.campaignId, campaign),
        inArray(locations.id, [...ids]),
        isNotNull(locations.deletedAt),
      ),
    )
    .orderBy(asc(locations.id))
    .all()
    .map(locationBlocker);
}

/**
 * Remove for good every location that went to the trash before `cutoff`,
 * across all campaigns — after the scenes that play there, before its
 * chapter (./trash.ts). Returns the campaign of each removed location.
 */
export function purgeLocations(tx: GrimoireDb, cutoff: string): string[] {
  const expired = and(isNotNull(locations.deletedAt), lt(locations.deletedAt, cutoff));
  const campaigns = tx
    .select({ campaignId: locations.campaignId })
    .from(locations)
    .where(expired)
    .all()
    .map((row) => row.campaignId);
  tx.delete(locations).where(expired).run();
  return campaigns;
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

/**
 * True when a location under this id may not be filled: one that holds
 * something, and one in the trash, empty or not — its id stays taken until
 * the purge, and nothing writes into a row there (decisions/trash).
 */
export function locationTaken(tx: GrimoireDb, campaign: string, id: string): boolean {
  const row = storedLocationRowOf(tx, campaign, id);
  return row !== undefined && (row.deletedAt !== null || !isEmptyLocationRow(row));
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
    const existing = storedLocationRowOf(tx, campaign, id);
    if (locationTaken(tx, campaign, id)) {
      // Same as for an npc: an empty location and one in the trash are
      // claimed, so neither is ever proposed.
      const suggestion = freeSlug(
        id,
        (candidate) => storedLocationRowOf(tx, campaign, candidate) !== undefined,
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

/**
 * One LIVE location row by id, read through `tx` (the database or a
 * transaction) — a location in the trash is not there for any read of
 * content.
 */
export function locationRowOf(tx: GrimoireDb, campaign: string, id: string): LocationRow | undefined {
  return tx
    .select()
    .from(locations)
    .where(
      and(eq(locations.campaignId, campaign), eq(locations.id, id), isNull(locations.deletedAt)),
    )
    .all()[0] as LocationRow | undefined;
}

/** One location row by id, live or in the trash — for the trash and for id checks. */
export function storedLocationRowOf(
  tx: GrimoireDb,
  campaign: string,
  id: string,
): LocationRow | undefined {
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
