// An entry's ADDRESS as the app handles it: the one string that names an entry
// (`server/src/store/paths.ts` spells the schema, `@grimoire/shared/kind`
// answers which kind it names).
//
// The address is a compound: the slashes are the schema, the segments are ids
// that may carry anything an id may carry. Every place that puts an address
// into a URL does it the same way here instead of spelling the split out
// again.

/**
 * The address as a URL path: one encoded segment per address segment. Encoded
 * PER SEGMENT, never as a whole — the separators have to survive, an umlaut or
 * a space inside a segment must not.
 */
export function encodeAddress(address: string): string {
  return address.split("/").map(encodeURIComponent).join("/");
}
