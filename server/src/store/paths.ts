// Addresses.
//
// The entries of a campaign are reached by address — `GET /entries/<address>`,
// `EntryResponse.path`, every link to one in the app — and an address names a
// ROW, derived from that row.
//
// THE ADDRESS SCHEMA, complete:
//
//   campaign    the campaign row
//   <chapter>   a chapter row
//
// `campaign`, `inbox`, `glossary`, `npcs`, `locations` and `sessions` are
// reserved, so none of them can be a chapter id. `inbox`, `glossary` and
// `sessions` are reserved AND NOTHING ELSE: the inbox, the glossary and a
// session are LISTS with their own endpoints (ADR #26), so none of them has an
// address here. They stay reserved because a chapter that claimed one of those
// ids would collide with the API path of its list. `npcs` and `locations` are
// the same: an npc and a location are each their own resource (ADR #31,
// `…/npcs/:id`, `…/locations/:id`) and have no address either. A scene is its
// own resource too (`…/scenes/:id`) and has no address.
//
// An address the schema does not describe names nothing and answers 404 —
// every address of more than one segment among them.

import { addressSegments } from "@grimoire/shared";
import { ApiError } from "../api-error";

// The address DECOMPOSITION helper lives in @grimoire/shared, because the app
// reads segments too and shared/ may not depend on the server. It is
// re-exported here so everything server-side takes an address apart through
// this module — the one that also writes them.
export { addressSegments };

/** Which row a campaign-relative address names. */
export type Locator = { kind: "campaign" } | { kind: "chapter"; id: string };

/** The one campaign-level entry. */
export const CAMPAIGN_PATH = "campaign";

/**
 * Reserved segments that are not chapters — the ONE source for this set
 * (`locatorFromPath` answers 404 for each of them, so a chapter that claimed
 * one would be a row nothing can read). Imported by the chapter create
 * (./chapters.ts) rather than re-declared there.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  CAMPAIGN_PATH,
  "inbox",
  "glossary",
  "npcs",
  "locations",
  "sessions",
]);

/** A chapter's address is its id. */
export function chapterPath(id: string): string {
  return id;
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
  const only = segments[0] ?? "";
  if (segments.length !== 1 || only === "") throw new ApiError(404, "entry not found");
  if (only === CAMPAIGN_PATH) return { kind: "campaign" };
  if (RESERVED_SEGMENTS.has(only)) throw new ApiError(404, "entry not found");
  return { kind: "chapter", id: only };
}
