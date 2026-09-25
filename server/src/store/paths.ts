// Addresses.
//
// The API is address-centric — `GET /entries/<address>`, `EntryResponse.path`,
// every link in the app — and an address names a ROW, derived from that row.
//
// THE ADDRESS SCHEMA, complete:
//
//   campaign                         the campaign row
//   <chapter>                        a chapter row
//   <chapter>/<scene-id>             a scene without a `location`
//   <chapter>/<location>/<scene-id>  a scene whose `location` names that location
//
// Two things to know about the segments:
//
//   * a SCENE's GROUP segment is its `location` and nothing else. There is no
//     independent grouping: the group is derived, so a scene can never sit in
//     a group that contradicts the location it names. The consequence is that
//     a scene's address MOVES when its `location` does, and an address that
//     names the right scene with a stale group is therefore not an error —
//     the store resolves a scene by ID and answers with the CURRENT address in
//     `EntryResponse.path`, which the app follows.
//   * `campaign`, `inbox`, `glossary`, `npcs`, `locations` and `sessions` are
//     reserved as first segments, so none of them can be a chapter id.
//     `inbox`, `glossary` and `sessions` are reserved AND NOTHING ELSE: the
//     inbox, the glossary and a session are LISTS with their own endpoints
//     (ADR #26), so none of them has an address here. They stay reserved
//     because a chapter that claimed one of those ids would collide with the
//     API path of its list. `npcs` and `locations` are the same: an npc and a
//     location are each their own resource (ADR #31, `…/npcs/:id`,
//     `…/locations/:id`) and have no address either.
//
// An address the schema does not describe names nothing and answers 404.

import { addressHead, addressSegments } from "@grimoire/shared";
import { ApiError } from "../api-error";

// The two address DECOMPOSITION helpers live in @grimoire/shared, because the
// app reads segments too and shared/ may not depend on the server. They are
// re-exported here so everything server-side takes an address apart through
// this module — the one that also writes them.
export { addressHead, addressSegments };

/** Which row a campaign-relative address names. */
export type Locator =
  | { kind: "campaign" }
  | { kind: "chapter"; id: string }
  | { kind: "scene"; id: string; chapterId: string; groupSlug: string };

/** The one campaign-level entry. */
export const CAMPAIGN_PATH = "campaign";

/**
 * Reserved first segments that are not chapters — the ONE source for this set
 * (`locatorFromPath` answers 404 for every address under one of them, so a
 * chapter that claimed one would be a row nothing can read). Imported by the
 * chapter create (./chapters.ts) rather than re-declared there.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  CAMPAIGN_PATH,
  "inbox",
  "glossary",
  "npcs",
  "locations",
  "sessions",
]);

const RESERVED = RESERVED_SEGMENTS;

/** A chapter's address is its id. */
export function chapterPath(id: string): string {
  return id;
}

export function scenePath(chapterId: string, groupSlug: string, id: string): string {
  return groupSlug === "" ? `${chapterId}/${id}` : `${chapterId}/${groupSlug}/${id}`;
}

/**
 * The address of a scene ROW — the one place that knows the group segment is
 * the scene's `location`. Structural on purpose: paths.ts must
 * not depend on the schema.
 */
export function sceneAddress(row: {
  chapterId: string | null;
  location: string | null;
  id: string;
}): string {
  return scenePath(row.chapterId ?? "", row.location ?? "", row.id);
}

/**
 * The ROW one address names, as a comparable key: `<kind>/<id>`.
 *
 * Two addresses that differ can still name the same row — a scene's group
 * segment is its `location`, so `01-x/hafen/ankunft` and
 * `01-x/bucht/ankunft` are the same scene under two different locations. The
 * primary key is `(campaign, id)`, so anything asking "is this the same
 * target?" has to ask by identity and not by address; an address the schema
 * does not describe is its own key (it names nothing and cannot collide).
 */
export function addressIdentity(rel: string): string {
  try {
    const locator = locatorFromPath(rel);
    return "id" in locator ? `${locator.kind}/${locator.id}` : locator.kind;
  } catch {
    return rel;
  }
}

/**
 * Parse a campaign-relative address into the row it names — LEXICALLY, so
 * this stays a pure function; whether the row exists is the store's answer
 * (404). Address safety (no `..`, no absolute paths, no hidden segments) is
 * enforced by `assertSafeAddress` before this is called.
 *
 * An address the schema does not describe throws 404 rather than 400: from
 * the client's side "there is no such entry" is exactly what it means.
 */
export function locatorFromPath(rel: string): Locator {
  const segments = addressSegments(rel);
  const last = segments[segments.length - 1] ?? "";

  if (segments.length === 1) {
    if (last === CAMPAIGN_PATH) return { kind: "campaign" };
    if (last === "" || RESERVED.has(last)) throw new ApiError(404, "entry not found");
    return { kind: "chapter", id: last };
  }

  const first = addressHead(rel);
  // `npcs/<id>`, `locations/<id>` and the list segments name nothing here:
  // an npc and a location are each their own resource (ADR #31) and a list
  // has none at all (ADR #26).
  if (RESERVED.has(first)) throw new ApiError(404, "entry not found");

  if (last === "") throw new ApiError(404, "entry not found");
  if (segments.length === 2) {
    return { kind: "scene", id: last, chapterId: first, groupSlug: "" };
  }
  if (segments.length === 3) {
    return { kind: "scene", id: last, chapterId: first, groupSlug: segments[1] ?? "" };
  }
  throw new ApiError(404, "entry not found");
}
