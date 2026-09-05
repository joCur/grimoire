// Paths as ADDRESSES (issue #57).
//
// The API surface is path-centric — `GET /file?path=…`, `ParsedFile.path`,
// every link in the app — and that stays true after the cutover: a path is
// now DERIVED from the row rather than read off a directory entry. The
// derivation is the format's own layout (README, "Entitäten"), so every path
// the app has ever seen still means the same thing:
//
//   _campaign.md                          the campaign row
//   <chapter>/_chapter.md                 a chapter row
//   <chapter>/<scene-id>.md               a scene with group_slug ""
//   <chapter>/<group>/<scene-id>.md       a scene inside a location group
//   npcs/<id>.md                          an npc row
//   locations/<id>.md                     a location row
//   sessions/<id>.md                      a session row
//   inbox.md / glossary.md                the campaign's two list tables
//
// ONE DEVIATION, deliberate and recorded in the PR: a scene's path segment is
// its ID, not its former file name. The planning drops `scenes.file_slug`
// (section 2), so the file stem no longer exists anywhere — and the id is the
// better address anyway: it is the key the format calls stable
// ("id … NIE ändern"), while the file name never was.

import { ApiError } from "../campaign-fs";

/** Which row a campaign-relative path addresses. */
export type Locator =
  | { kind: "campaign" }
  | { kind: "chapter"; id: string }
  | { kind: "scene"; id: string; chapterId: string; groupSlug: string }
  | { kind: "npc"; id: string }
  | { kind: "location"; id: string }
  | { kind: "session"; id: string }
  | { kind: "inbox" }
  | { kind: "glossary" };

/** The campaign metadata file (unchanged name). */
export const CAMPAIGN_PATH = "_campaign.md";
export const INBOX_PATH = "inbox.md";
export const GLOSSARY_PATH = "glossary.md";

/** Reserved directories that are not chapters (mirror of campaign-fs). */
const RESERVED = new Set(["npcs", "locations", "sessions"]);

export function chapterPath(id: string): string {
  return `${id}/_chapter.md`;
}

export function scenePath(chapterId: string, groupSlug: string, id: string): string {
  return groupSlug === "" ? `${chapterId}/${id}.md` : `${chapterId}/${groupSlug}/${id}.md`;
}

export function npcPath(id: string): string {
  return `npcs/${id}.md`;
}

export function locationPath(id: string): string {
  return `locations/${id}.md`;
}

export function sessionPath(id: string): string {
  return `sessions/${id}.md`;
}

/**
 * Parse a campaign-relative path into the row it addresses — LEXICALLY, so
 * this stays a pure function; whether the row exists is the store's answer
 * (404). Path safety (no `..`, no absolute paths, no hidden segments, `.md`
 * only) is enforced by `assertSafeRelativeMdPath` before this is called.
 *
 * A path the layout does not describe throws 404 rather than 400: from the
 * client's side "there is no such file" is exactly what it means, and it is
 * what the file-tree reader answered too.
 */
export function locatorFromPath(rel: string): Locator {
  const segments = rel.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const stem = basename.slice(0, -".md".length);

  if (segments.length === 1) {
    if (basename === CAMPAIGN_PATH) return { kind: "campaign" };
    if (basename === INBOX_PATH) return { kind: "inbox" };
    if (basename === GLOSSARY_PATH || basename === "glossar.md") return { kind: "glossary" };
    throw new ApiError(404, "file not found");
  }

  const first = segments[0] ?? "";
  if (RESERVED.has(first)) {
    if (segments.length !== 2 || stem === "") throw new ApiError(404, "file not found");
    if (first === "npcs") return { kind: "npc", id: stem };
    if (first === "locations") return { kind: "location", id: stem };
    return { kind: "session", id: stem };
  }

  if (basename === "_chapter.md") {
    if (segments.length !== 2) throw new ApiError(404, "file not found");
    return { kind: "chapter", id: first };
  }
  if (stem === "") throw new ApiError(404, "file not found");
  if (segments.length === 2) {
    return { kind: "scene", id: stem, chapterId: first, groupSlug: "" };
  }
  if (segments.length === 3) {
    return { kind: "scene", id: stem, chapterId: first, groupSlug: segments[1] ?? "" };
  }
  throw new ApiError(404, "file not found");
}
