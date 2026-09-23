// Locations: the location entry read, written, created and taken over from a
// draft — all of it typed by the location's one zod schema (ADR #31,
// @grimoire/shared/location). Nothing here assembles a properties mapping:
// a row renders into a `Location`, and a `LocationPatch` or a
// `LocationDraft` writes into a row.
//
// A location is the group a scene hangs in (ADR #17), so its id is a
// reference key long before the entry holds anything. Creating one therefore
// fills an entry the DM created and left empty rather than colliding with it
// — the same rule an npc follows (./npcs.ts), decided over the columns a
// location actually has.

import { and, eq } from "drizzle-orm";
import {
  freeSlug,
  locationDraftSchema,
  locationPatchSchema,
  type Location,
  type LocationDraft,
  type LocationPatch,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { locations } from "../db/schema";
import { mutate } from "./campaigns";
import { assertChapterRef, indexLocation, locationRowOf } from "./entity-rows";
import { locationPath } from "./paths";
import type { LocationRow } from "./render";
import { normalizeBody, parseRequest, resolveNewId, revConflict, slugTaken } from "./shared";

// --- rendering a row ----------------------------------------------------------

/**
 * The location entry of a row. An empty name falls back to the id — the
 * display-name rule of every entry — and a column that holds nothing is a
 * field the entry does not carry.
 */
export function renderLocation(row: LocationRow): Location {
  return {
    kind: "location",
    id: row.id,
    path: locationPath(row.id),
    name: row.name === "" ? row.id : row.name,
    ...(row.chapterId === null ? {} : { chapter: row.chapterId }),
    ...(row.roll20Page === null ? {} : { "roll20-page": row.roll20Page }),
    ...(row.atmosphere === null ? {} : { atmosphere: row.atmosphere }),
    body: row.body,
    rev: row.rev,
  };
}

// --- an entry that holds nothing but its id -----------------------------------

export function isEmptyLocationRow(row: LocationRow): boolean {
  return (
    row.name === "" &&
    row.chapterId === null &&
    row.roll20Page === null &&
    row.atmosphere === null &&
    row.body.trim() === ""
  );
}

// --- reading a location entry -------------------------------------------------

/**
 * The location entry an address names; 404 when the campaign has no location
 * with that id.
 */
export function readLocationEntry(tx: GrimoireDb, campaign: string, id: string): Location {
  const row = locationRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  return renderLocation(row);
}

// --- writing a location entry -------------------------------------------------

/**
 * The body of a location PATCH, checked against the location's schema: the
 * guard, `force`, the text and any subset of the fields — a key that is none
 * of these, or a value of the wrong shape, is a 400 that names it.
 */
export function readLocationPatch(raw: unknown): LocationPatch {
  return parseRequest(locationPatchSchema, raw, "location patch");
}

/**
 * THE write of one location (ADR #23), INSIDE the caller's transaction:
 * fields, text, or both in one row update against one `rev`.
 *
 * Only the fields the patch names are touched; `null` clears an optional
 * one. `force` replaces the guard by the row's current rev — the DM's answer
 * to the conflict dialog, which writes only what this request carries. A
 * `chapter` has to name a chapter that exists (400 otherwise), and the id
 * never changes (ADR #21): a patch may echo it, never alter it.
 */
export function patchLocationIn(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  patch: LocationPatch,
): Location {
  const { rev, force, body, id: patchedId, ...fields } = patch;
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined && body === undefined) {
    throw new ApiError(400, "nothing to write — send fields, body, or both", {
      code: "nothing_to_write",
    });
  }
  const row = locationRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  const guard = force === true ? row.rev : rev;
  if (row.rev !== guard) throw revConflict(row.rev, "location changed", renderLocation(row));
  if (patchedId !== undefined && patchedId !== row.id) {
    throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
  }
  const next: LocationRow = {
    ...row,
    name: fields.name ?? row.name,
    chapterId: fields.chapter === undefined ? row.chapterId : fields.chapter,
    roll20Page: fields["roll20-page"] === undefined ? row.roll20Page : fields["roll20-page"],
    atmosphere: fields.atmosphere === undefined ? row.atmosphere : fields.atmosphere,
    body: body === undefined ? row.body : normalizeBody(body),
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

// --- taking over a draft ------------------------------------------------------

/**
 * A location draft — a fixture or a generator proposal — checked against the
 * location's schema: the entry without its address and its guard. A key the
 * location does not have, or a value of the wrong shape, is refused with the
 * message `what` introduces.
 */
export function readLocationDraft(raw: unknown, what: string): LocationDraft {
  return parseRequest(locationDraftSchema, raw, what);
}

/**
 * Write one location draft into the campaign, INSIDE the caller's
 * transaction — the seed and the generator's accept both end here. The
 * caller has checked for conflicts: an entry the DM created and left empty is
 * FILLED rather than collided with (see `isEmptyLocationRow`).
 */
export function insertLocationDraft(tx: GrimoireDb, campaign: string, draft: LocationDraft): void {
  assertChapterRef(tx, campaign, draft.chapter ?? null);
  const values = {
    name: draft.name,
    chapterId: draft.chapter ?? null,
    roll20Page: draft["roll20-page"] ?? null,
    atmosphere: draft.atmosphere ?? null,
    body: draft.body,
  };
  const existing = locationRowOf(tx, campaign, draft.id);
  if (existing !== undefined) {
    tx.update(locations)
      .set({ ...values, rev: existing.rev + 1 })
      .where(and(eq(locations.campaignId, campaign), eq(locations.id, draft.id)))
      .run();
  } else {
    tx.insert(locations)
      .values({ campaignId: campaign, id: draft.id, ...values })
      .run();
  }
  const row = locationRowOf(tx, campaign, draft.id);
  if (row !== undefined) indexLocation(tx, campaign, row);
}

// --- creating a location ------------------------------------------------------

/** POST /api/campaigns/:campaign/locations { name } -> the location entry. */
export async function createLocation(
  campaign: string,
  name: string,
  explicitId?: string,
): Promise<Location> {
  const id = resolveNewId(explicitId, name, "location", "name");
  return mutate(campaign, (tx) => {
    const existing = locationRowOf(tx, campaign, id);
    if (existing !== undefined && !isEmptyLocationRow(existing)) {
      // Same as for an npc: an empty entry is claimed, so it is never proposed.
      const suggestion = freeSlug(
        id,
        (candidate) => locationRowOf(tx, campaign, candidate) !== undefined,
      );
      throw slugTaken("location", id, suggestion, locationPath(id));
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
