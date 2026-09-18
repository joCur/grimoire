// Entity-kind detection from an ADDRESS — the one string that names an entry
// (server/src/store/paths.ts is the schema): what the app links to and what
// every response's `path` is.
//
// Its own module on purpose: the app imports `@grimoire/shared/kind` — types
// plus this function, no runtime dependencies — instead of the package root.

import { addressSegments } from "./address";
import type { EntityKind } from "./types";

/**
 * The kind an API address names. Mirrors `locatorFromPath` in
 * server/src/store/paths.ts without the 404s: an address the schema does not
 * describe is `unknown`.
 */
export function kindFromAddress(address: string): EntityKind {
  const segments = addressSegments(address).filter((segment) => segment.length > 0);
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
