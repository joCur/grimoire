// What the edit mode of a reading view saves — the rules it needs before any
// write is involved.
//
// The surface edits a text and, beside it, the PROSE fields of its kind —
// an npc's `motivation`, a location's `atmosphere` (@grimoire/shared
// `FieldSurface`). One save carries what changed, and the kind's editing
// session turns it into its own write: an entry's PATCH puts the fields under
// `properties` (lib/use-entry-edit.ts), a location's PATCH carries them beside
// `body` (lib/use-location-edit.ts). Every other field is deliberately not
// part of this surface: the status control and the dialog own those, and a
// request that does not name them leaves them untouched — a forced save
// included (ADR #23).
//
// Everything in this module is pure, so the rules are unit-testable.

/** One save of the edit surface: the text, and the patch of the prose fields that moved. */
export interface BodyEditChange {
  body?: string;
  fields?: Record<string, unknown>;
}

/**
 * Is there anything to save? Compared verbatim — the body is the payload, and
 * whitespace at the end of a line can be markdown (two spaces = line break),
 * so nothing is normalized away before the comparison.
 *
 * Two callers, one rule: the save button is dead without changes, and the
 * cancel action only asks for confirmation when there is work to lose.
 */
export function hasBodyChanges(original: string, draft: string): boolean {
  return draft !== original;
}

/**
 * The one save of the edit surface: each half only when it CHANGED. The text
 * travels when it differs from the baseline, the prose fields as the patch of
 * the ones that moved (lib/properties-form.ts `propertiesPatch`). An empty
 * change means there is nothing to save.
 *
 * Only-what-changed is what keeps a forced save honest: it resends this change
 * on top of the stored row, so a half the DM did not touch must not be in it
 * — a text write must not reset a `motivation` somebody else just wrote.
 */
export function bodyEditorChange(
  baseline: string,
  body: string,
  fieldsPatch: Record<string, unknown>,
): BodyEditChange {
  return {
    ...(hasBodyChanges(baseline, body) ? { body } : {}),
    ...(Object.keys(fieldsPatch).length > 0 ? { fields: fieldsPatch } : {}),
  };
}

/** Does a change carry anything? */
export function hasBodyEditChange(change: BodyEditChange): boolean {
  return change.body !== undefined || change.fields !== undefined;
}
