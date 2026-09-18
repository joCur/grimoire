// Orte: creating a location entry, and what "empty" means for one.
//
// A location is the group a scene hangs in (ADR #17), so its id is a
// reference key long before the entry holds anything. Creating one therefore
// fills an entry the DM created and left empty rather than colliding with it
// — the same rule an npc follows (./npcs.ts), decided over the columns a
// location actually has.

import { and, eq } from "drizzle-orm";
import { freeSlug, type EntryResponse } from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { locations } from "../db/schema";
import { mutate } from "./campaigns";
import { indexLocation, locationRowOf } from "./entity-rows";
import { locationPath } from "./paths";
import { renderLocation, type LocationRow } from "./render";
import { resolveNewId, slugTaken } from "./shared";

// --- an entry that holds nothing but its id -----------------------------------

export function isEmptyLocationRow(row: LocationRow): boolean {
  return (
    row.name === "" &&
    row.chapterId === null &&
    row.roll20Page === null &&
    row.body.trim() === ""
  );
}

// --- reading a location entry -------------------------------------------------

/**
 * The location entry an address names; 404 when the campaign has no location
 * with that id.
 */
export function readLocationEntry(
  tx: GrimoireDb,
  campaign: string,
  id: string,
): EntryResponse {
  const row = locationRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  return renderLocation(row);
}

// --- creating a location ------------------------------------------------------

/** POST /api/campaigns/:campaign/locations { name } -> the location entry. */
export async function createLocation(
  campaign: string,
  name: string,
  explicitId?: string,
): Promise<EntryResponse> {
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
