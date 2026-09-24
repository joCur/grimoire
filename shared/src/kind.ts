// Entity-kind detection from an ADDRESS — the one string that names an entry
// (server/src/store/paths.ts is the schema): what the app links to and what
// every entry response's `path` is.
//
// Its own module on purpose: the app imports `@grimoire/shared/kind` — types
// plus this function, no runtime dependencies — instead of the package root.

import { addressSegments } from "./address";
import type { EntryKind } from "./types";

/**
 * The first segments that are not a chapter id: the npc prefix, `locations`
 * (a location is its own resource, ADR #31) and the three LIST segments. They
 * are reserved so no chapter can claim one (server/src/store/paths.ts holds
 * the full set and the reason).
 */
const RESERVED_HEADS: ReadonlySet<string> = new Set([
  "npcs",
  "locations",
  "inbox",
  "glossary",
  "sessions",
]);

/**
 * The kind an API address names. Mirrors `locatorFromPath` in
 * server/src/store/paths.ts without the 404s: an address the schema does not
 * describe is `unknown`.
 *
 * The campaign, its chapters, scenes and npcs have an address. `locations`,
 * `inbox`, `glossary` and `sessions` are reserved segments and nothing
 * else — a location is its own resource (ADR #31), the others are lists with
 * their own endpoints (ADR #26) — so an address reaching for one of them
 * names nothing and reads as `unknown`.
 */
export function kindFromAddress(address: string): EntryKind | "unknown" {
  const segments = addressSegments(address).filter((segment) => segment.length > 0);
  const first = segments[0] ?? "";
  if (segments.length === 1) {
    if (first === "campaign") return "campaign";
    if (RESERVED_HEADS.has(first)) return "unknown";
    return "chapter";
  }
  if (segments.length === 2) {
    if (first === "npcs") return "npc";
  }
  if (first === "campaign" || RESERVED_HEADS.has(first)) return "unknown";
  if (segments.length === 2 || segments.length === 3) return "scene";
  return "unknown";
}
