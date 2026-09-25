// Entity-kind detection from an ADDRESS — the one string that names an entry
// (server/src/store/paths.ts is the schema): what the app links to and what
// every entry response's `path` is.
//
// Its own module on purpose: the app imports `@grimoire/shared/kind` — types
// plus this function, no runtime dependencies — instead of the package root.

import { addressSegments } from "./address";
import type { EntryKind } from "./types";

/**
 * The segments that are not a chapter id: `npcs` and `locations` and the
 * three LIST segments. They are reserved so no chapter can claim one
 * (server/src/store/paths.ts holds the full set and the reason).
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
 * The campaign and its chapters have an address, and each is one segment. A
 * scene, an npc and a location are each their own resource (ADR #31), and the
 * list segments are lists with their own endpoints (ADR #26), so an address
 * of more than one segment — or one of the reserved segments — names nothing
 * and reads as `unknown`.
 */
export function kindFromAddress(address: string): EntryKind | "unknown" {
  const segments = addressSegments(address).filter((segment) => segment.length > 0);
  if (segments.length !== 1) return "unknown";
  const only = segments[0] ?? "";
  if (only === "campaign") return "campaign";
  if (RESERVED_HEADS.has(only)) return "unknown";
  return "chapter";
}
