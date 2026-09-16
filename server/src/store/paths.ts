// Addresses.
//
// The API is address-centric — `GET /entry?path=…`, `EntryResponse.path`,
// every link in the app — and an address names a ROW, derived from that row.
//
// THE ADDRESS SCHEMA, complete:
//
//   campaign                         the campaign row
//   inbox                            the campaign's inbox list
//   glossary                         the campaign's glossary list
//   <chapter>                        a chapter row
//   <chapter>/<scene-id>             a scene without a `location`
//   <chapter>/<location>/<scene-id>  a scene whose `location` names that location
//   npcs/<id>                        an npc row
//   locations/<id>                   a location row
//   sessions/<id>                    a session row
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
//
// An address the schema does not describe names nothing and answers 404.

import { ApiError } from "../api-error";

/** Which row a campaign-relative address names. */
export type Locator =
  | { kind: "campaign" }
  | { kind: "chapter"; id: string }
  | { kind: "scene"; id: string; chapterId: string; groupSlug: string }
  | { kind: "npc"; id: string }
  | { kind: "location"; id: string }
  | { kind: "session"; id: string }
  | { kind: "inbox" }
  | { kind: "glossary" };

/** The three campaign-level entries. */
export const CAMPAIGN_PATH = "campaign";
export const INBOX_PATH = "inbox";
export const GLOSSARY_PATH = "glossary";

/**
 * Reserved first segments that are not chapters — the ONE source for this set
 * (`locatorFromPath` routes them to their kinds, so a chapter or a rename that
 * claimed one of them would produce an address nothing can read). Imported by
 * ./write.ts (create) and ./rename.ts (rename) rather than re-declared there.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  CAMPAIGN_PATH,
  INBOX_PATH,
  GLOSSARY_PATH,
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
 * the scene's `location` (issue #100). Structural on purpose: paths.ts must
 * not depend on the schema.
 */
export function sceneAddress(row: {
  chapterId: string | null;
  location: string | null;
  id: string;
}): string {
  return scenePath(row.chapterId ?? "", row.location ?? "", row.id);
}

export function npcPath(id: string): string {
  return `npcs/${id}`;
}

export function locationPath(id: string): string {
  return `locations/${id}`;
}

export function sessionPath(id: string): string {
  return `sessions/${id}`;
}

/**
 * The ROW one address names, as a comparable key: `<kind>/<id>`.
 *
 * Two addresses that differ can still name the same row — a scene's group
 * segment is its `location` (issue #100), so `01-x/hafen/ankunft` and
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
  const segments = rel.split("/");
  const last = segments[segments.length - 1] ?? "";

  if (segments.length === 1) {
    if (last === CAMPAIGN_PATH) return { kind: "campaign" };
    if (last === INBOX_PATH) return { kind: "inbox" };
    if (last === GLOSSARY_PATH) return { kind: "glossary" };
    if (last === "" || RESERVED.has(last)) throw new ApiError(404, "entry not found");
    return { kind: "chapter", id: last };
  }

  const first = segments[0] ?? "";
  if (RESERVED.has(first)) {
    if (segments.length !== 2 || last === "") throw new ApiError(404, "entry not found");
    if (first === "npcs") return { kind: "npc", id: last };
    if (first === "locations") return { kind: "location", id: last };
    if (first === "sessions") return { kind: "session", id: last };
    throw new ApiError(404, "entry not found");
  }

  if (last === "") throw new ApiError(404, "entry not found");
  if (segments.length === 2) {
    return { kind: "scene", id: last, chapterId: first, groupSlug: "" };
  }
  if (segments.length === 3) {
    return { kind: "scene", id: last, chapterId: first, groupSlug: segments[1] ?? "" };
  }
  throw new ApiError(404, "entry not found");
}
