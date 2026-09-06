// Entity-kind detection from a campaign-relative path — the folder half of
// the format contract (README.md, "Entitäten").
//
// Its own module on purpose: this is the ONE place the folder conventions are
// written down in code, and both sides need it. parse.ts pulls in gray-matter,
// which has no business in a browser bundle, so the app imports
// `@grimoire/shared/kind` (types plus this function, no runtime dependencies)
// while the server keeps getting it re-exported from the package root.

import type { EntityKind } from "./types";

/**
 * Detect the entity kind purely from the campaign-relative path, per the
 * layout in README.md:
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
 * Both spellings work, and on purpose: the API's ADDRESSES carry no extension
 * since issue #79 (store/paths.ts), while the markdown IMPORTER hands in file
 * paths that still end in `.md` (server/src/db/). A trailing `.md` is
 * therefore stripped; any OTHER extension left on the last segment means
 * "not one of ours" and answers `unknown`, so `map.png` and `notes.txt` are
 * still not scenes.
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
    // Campaign metadata lives in the campaign ROOT only (issue #17); a deeper
    // `_campaign` keeps whatever kind its depth gives it.
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
