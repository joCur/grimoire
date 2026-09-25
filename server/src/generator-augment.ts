// What the augment runs share: the slice of a create prompt that describes an
// entity's fields, and the comparison of a current value with a proposed one.
//
// Each entity is augmented on its own resource by its own module
// (./scene-augment.ts, ./npc-augment.ts, ./location-augment.ts, ADR #31); the
// helpers here know nothing about any entity.
//
// WHY A PROPOSAL CARRIES WHOLE BODIES and not a block list: the block model
// is the Block-Composer's (app/src/lib/blocks.ts), and the review's decision
// unit has to be the unit the DM already edits. Cutting the diff in the app
// against that very model is the only way those two can never drift; the
// server stays the authority for what is WRITTEN, not for how it is shown.
// The app therefore sends back the body it assembled from the accepted
// blocks, and the server writes it like any other body write — same rev
// guard, same FTS, same reference rows, same reference checks.

/**
 * The FORMAT half of a create prompt: its title line plus the section under
 * `heading` — the entity's fields —, and nothing else.
 *
 * Why the slice: a create prompt also carries its own „## Ausgabeformat" and
 * its own „## Regeln", written for a run that creates something. Embedding
 * the whole prompt would put TWO contradictory output schemas in front of the
 * model, and "this prompt wins" is a sentence, not a guarantee. The augment
 * run brings its own output schema and its own rules; all it needs from the
 * create prompt is the shape of the entity.
 *
 * Degrades: a prompt without the heading travels whole rather than empty —
 * a missing section must not silently strip the format contract.
 */
export function formatContract(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start === -1) return doc;
  const rest = doc.slice(start + heading.length);
  const next = rest.indexOf("\n## ");
  const section = next === -1 ? rest : rest.slice(0, next);
  const title = doc.startsWith("# ") ? `${doc.slice(0, doc.indexOf("\n"))}\n\n` : "";
  return `${title}${heading}${section.trimEnd()}\n`;
}

/**
 * "There is no value here": absent, null, a blank string and an empty
 * list/mapping all count; `false` and `0` do NOT — those are values the DM
 * chose.
 */
export function isEmptyValue(value: unknown): boolean {
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
