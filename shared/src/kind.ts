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
 * folder conventions in README.md:
 *
 *   npcs/<id>.md            -> npc
 *   locations/<id>.md       -> location
 *   sessions/<date>.md      -> session
 *   _campaign.md            -> campaign  (campaign root only)
 *   inbox.md                -> inbox
 *   glossary.md             -> glossary
 *   **\/_chapter.md         -> chapter
 *   <chapter>/**\/*.md      -> scene   (any other .md at depth >= 2)
 *   everything else         -> unknown
 */
export function kindFromPath(path: string): EntityKind {
  // Normalize: forward slashes, no leading "./" or "/".
  const normalized = path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return "unknown";

  const basename = segments[segments.length - 1]!;
  if (!basename.endsWith(".md")) return "unknown";

  if (segments.length === 1) {
    // Campaign metadata lives in the campaign ROOT only (issue #17); deeper
    // `_campaign.md` files keep whatever kind their depth gives them.
    if (basename === "_campaign.md") return "campaign";
    if (basename === "inbox.md") return "inbox";
    if (basename === "glossary.md") return "glossary";
    return "unknown";
  }

  if (segments.length === 2) {
    if (segments[0] === "npcs") return "npc";
    if (segments[0] === "locations") return "location";
    if (segments[0] === "sessions") return "session";
  }

  if (basename === "_chapter.md") return "chapter";

  // Any other markdown file at depth >= 2 lives inside a chapter directory
  // (directly or in a location-slug subfolder) and is a scene.
  return "scene";
}
