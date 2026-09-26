// The API client of a location (ADR #31): its resource — read, list,
// create, write — its write conflict, and the augment run on it. Built from
// the shared HTTP helpers (../api.ts).

import type { Location, LocationPatch } from "@grimoire/shared/location";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

import {
  ApiError,
  campaignPath,
  getJson,
  postJson,
  runTexts,
  sendJson,
  startJob,
} from "@/api";

/** The request path of a campaign's locations, or of one of them. */
function locationsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/locations`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** One location — every field flat, `body` among them, beside its `rev`. */
export function fetchLocation(campaign: string, id: string): Promise<Location> {
  return getJson<Location>(locationsUrl(campaign, id));
}

/** Every location of the campaign, sorted by name. */
export function fetchLocations(campaign: string): Promise<Location[]> {
  return getJson<Location[]>(locationsUrl(campaign));
}

/**
 * The one write of a location: any subset of its fields — `body` is one of
 * them, `null` clears an optional one — against the `rev` the editing
 * session started from. A stale `rev` is 409 with the current location
 * (`locationConflict`); `force` writes the given fields on top of it.
 */
export function patchLocation(
  campaign: string,
  id: string,
  request: LocationPatch,
): Promise<Location> {
  return sendJson<Location>("PATCH", locationsUrl(campaign, id), request);
}

/** The server's location at the moment it refused a write. */
export interface LocationConflict {
  /** The location's current version — what a retry would have to carry. */
  rev: number;
  /** The current location; undefined when the 409 body did not carry one. */
  location?: Location;
}

/**
 * Read a location write conflict out of a rejection: the 409 of the location
 * PATCH (and of accepting an augment proposal), with the version and the
 * location the server answered with. `undefined` for anything else. A 409
 * whose body is shaped differently still counts as a conflict, just without
 * the details.
 */
export function locationConflict(error: unknown): LocationConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { rev, location } = error.details;
  return {
    rev: typeof rev === "number" ? rev : Number.NaN,
    ...(isLocation(location) ? { location } : {}),
  };
}

function isLocation(value: unknown): value is Location {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Location>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.rev === "number"
  );
}

/** A new location, same rules as the npc one — answered as the location itself. */
export function createLocation(
  campaign: string,
  input: { name: string; id?: string },
): Promise<Location> {
  return postJson<Location>(locationsUrl(campaign), {
    name: input.name,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/**
 * Start an augment run on a location, on the location's own resource — the
 * same job model as every other run (`startJob`); the proposal is read
 * on the job (`kind: "location-augment"`, `locationAugmentResult`).
 */
export function startLocationAugmentJob(
  campaign: string,
  id: string,
  input: { sourceText?: string; instruction?: string },
): Promise<GeneratorJob> {
  return startJob(`${locationsUrl(campaign, id)}/augment`, runTexts(input));
}

/**
 * Accept a reviewed location proposal: the fields the DM took and the body
 * assembled from the accepted blocks — the location's PATCH without `force`
 * — written in ONE transaction against `rev`; `jobId` discards the job in
 * the same transaction. A 409 is the location conflict (`locationConflict`).
 */
export function applyLocationAugment(
  campaign: string,
  id: string,
  input: Omit<LocationPatch, "force" | "id"> & { jobId?: string },
): Promise<Location> {
  return postJson<Location>(`${locationsUrl(campaign, id)}/augment/apply`, input);
}
