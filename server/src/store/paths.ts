// Addresses (issues #57/#79).
//
// The API surface is address-centric — `GET /file?path=…`, `ParsedFile.path`,
// every link in the app — and an address names a ROW, derived from that row
// rather than read off a directory entry. Since issue #79 it carries no file
// extension either: the file era is over, so nothing is a `.md` any more.
//
// THE ADDRESS SCHEMA, complete:
//
//   _campaign                        the campaign row
//   inbox                            the campaign's inbox list
//   glossary                         the campaign's glossary list
//   <chapter>/_chapter               a chapter row
//   <chapter>/<scene-id>             a scene with group_slug ""
//   <chapter>/<group>/<scene-id>     a scene inside a location group
//   npcs/<id>                        an npc row
//   locations/<id>                   a location row
//   sessions/<id>                    a session row
//
// Two things to know about the segments:
//
//   * a SCENE's last segment is its ID, not a former file name. The id is the
//     key the format calls stable ("id … NIE ändern"); the file name never
//     was, and `scenes.file_slug` was dropped with the cutover.
//   * `_chapter` is reserved inside a chapter, `npcs`/`locations`/`sessions`
//     are reserved as first segments — the same reservations the format's
//     folder layout always had (README, "Entitäten").
//
// There is deliberately NO backwards compatibility for the old `.md` form
// (issue #79 AK7, PO: no stored URLs). An address that ends in `.md` simply
// names nothing and answers 404, like any other unknown address.

import { ApiError } from "../campaign-fs";

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

/** The three campaign-level documents. */
export const CAMPAIGN_PATH = "_campaign";
export const INBOX_PATH = "inbox";
export const GLOSSARY_PATH = "glossary";

/**
 * Reserved first segments that are not chapters — the ONE source for this set
 * (`locatorFromPath` routes them to the entity kinds, so a chapter or a rename
 * that claimed one of them would produce an address nothing can read).
 * Imported by ./write.ts (create) and ./rename.ts (rename) rather than
 * re-declared there.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "npcs",
  "locations",
  "sessions",
]);

const RESERVED = RESERVED_SEGMENTS;

/** Reserved last segment inside a chapter. */
const CHAPTER_DOC = "_chapter";

export function chapterPath(id: string): string {
  return `${id}/${CHAPTER_DOC}`;
}

export function scenePath(chapterId: string, groupSlug: string, id: string): string {
  return groupSlug === "" ? `${chapterId}/${id}` : `${chapterId}/${groupSlug}/${id}`;
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
 * Parse a campaign-relative address into the row it names — LEXICALLY, so
 * this stays a pure function; whether the row exists is the store's answer
 * (404). Address safety (no `..`, no absolute paths, no hidden segments) is
 * enforced by `assertSafeAddress` before this is called.
 *
 * An address the schema does not describe throws 404 rather than 400: from
 * the client's side "there is no such document" is exactly what it means.
 */
export function locatorFromPath(rel: string): Locator {
  const segments = rel.split("/");
  const last = segments[segments.length - 1] ?? "";

  if (segments.length === 1) {
    if (last === CAMPAIGN_PATH) return { kind: "campaign" };
    if (last === INBOX_PATH) return { kind: "inbox" };
    if (last === GLOSSARY_PATH || last === "glossar") return { kind: "glossary" };
    throw new ApiError(404, "file not found");
  }

  const first = segments[0] ?? "";
  if (RESERVED.has(first)) {
    if (segments.length !== 2 || last === "") throw new ApiError(404, "file not found");
    if (first === "npcs") return { kind: "npc", id: last };
    if (first === "locations") return { kind: "location", id: last };
    return { kind: "session", id: last };
  }

  if (last === CHAPTER_DOC) {
    if (segments.length !== 2) throw new ApiError(404, "file not found");
    return { kind: "chapter", id: first };
  }
  if (last === "") throw new ApiError(404, "file not found");
  if (segments.length === 2) {
    return { kind: "scene", id: last, chapterId: first, groupSlug: "" };
  }
  if (segments.length === 3) {
    return { kind: "scene", id: last, chapterId: first, groupSlug: segments[1] ?? "" };
  }
  throw new ApiError(404, "file not found");
}
