// Entity-kind detection — twice, because two different strings name an entry:
//
//   * `kindFromAddress` reads an API ADDRESS (server/src/store/paths.ts is the
//     schema): what the app links to and what every response's `path` is.
//   * `kindFromPath` reads a FILE PATH in the markdown tree the importer
//     (`grimoire seed`) walks — the folder layout described in README.md.
//
// Its own module on purpose: parse.ts pulls in gray-matter, which has no
// business in a browser bundle, so the app imports `@grimoire/shared/kind`
// (types plus these functions, no runtime dependencies).

import type { EntityKind } from "./types";

/**
 * The kind an API address names. Mirrors `locatorFromPath` in
 * server/src/store/paths.ts without the 404s: an address the schema does not
 * describe is `unknown`.
 */
export function kindFromAddress(address: string): EntityKind {
  const segments = address.split("/").filter((s) => s.length > 0);
  const first = segments[0] ?? "";
  if (segments.length === 1) {
    if (first === "campaign") return "campaign";
    if (first === "inbox") return "inbox";
    if (first === "glossary") return "glossary";
    if (first === "npcs" || first === "locations" || first === "sessions") return "unknown";
    return "chapter";
  }
  if (segments.length === 2) {
    if (first === "npcs") return "npc";
    if (first === "locations") return "location";
    if (first === "sessions") return "session";
  }
  if (first === "campaign" || first === "inbox" || first === "glossary") return "unknown";
  if (segments.length === 2 || segments.length === 3) return "scene";
  return "unknown";
}

/**
 * Detect the entity kind of a FILE in the markdown tree the importer reads,
 * per the layout in README.md:
 *
 *   npcs/<id>            -> npc
 *   locations/<id>       -> location
 *   sessions/<id>        -> session
 *   _campaign            -> campaign  (campaign root only)
 *   inbox                -> inbox
 *   glossary             -> glossary
 *   **\/_chapter         -> chapter
 *   <chapter>/**\/<id>   -> scene   (anything else at depth >= 2)
 *   everything else      -> unknown
 *
 * A trailing `.md` is stripped; any OTHER extension left on the last segment
 * means "not one of ours" and answers `unknown`, so `map.png` and `notes.txt`
 * are not scenes.
 */
export function kindFromPath(path: string): EntityKind {
  // Normalize: forward slashes, no leading "./" or "/".
  const normalized = path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return "unknown";

  const last = segments[segments.length - 1]!;
  const name = last.endsWith(".md") ? last.slice(0, -".md".length) : last;
  if (name === "" || name.includes(".")) return "unknown";

  if (segments.length === 1) {
    // Campaign metadata lives in the campaign ROOT only; a deeper `_campaign`
    // keeps whatever kind its depth gives it.
    if (name === "_campaign") return "campaign";
    if (name === "inbox") return "inbox";
    if (name === "glossary") return "glossary";
    return "unknown";
  }

  if (segments.length === 2) {
    if (segments[0] === "npcs") return "npc";
    if (segments[0] === "locations") return "location";
    if (segments[0] === "sessions") return "session";
  }

  if (name === "_chapter") return "chapter";

  // Anything else at depth >= 2 lives inside a chapter directory (directly or
  // in a location-slug subfolder) and is a scene.
  return "scene";
}
