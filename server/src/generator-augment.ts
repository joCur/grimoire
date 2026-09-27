// What the augment runs share: the comparison of a current value with a
// proposed one.
//
// Each entity is augmented on its own resource by its own module
// (./scene-augment.ts, ./npc-augment.ts, ./location-augment.ts, decisions/resources); the
// helpers here know nothing about any entity.
//
// WHY A PROPOSAL CARRIES WHOLE BODIES and not a block list: the block model
// is the Block-Composer's (@grimoire/shared/blocks), and the review's decision
// unit has to be the unit the DM already edits. Cutting the diff in the app
// against that very model is the only way those two can never drift; the
// server stays the authority for what is WRITTEN, not for how it is shown.
// The app therefore sends back the body it assembled from the accepted
// blocks, and the server writes it like any other body write — same rev
// guard, same FTS, same reference rows, same reference checks.

/**
 * "There is no value here": absent, null, a blank string and an empty
 * list/mapping all count; `false` and `0` do NOT — those are values the DM
 * chose.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Structural equality over the JSON-shaped values a field can hold. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => sameValue(left[key], right[key]));
}
