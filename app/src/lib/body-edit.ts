// What the edit mode of a reading view saves — the rules it needs before any
// write is involved.
//
// The surface edits a text and, beside it, the PROSE fields its caller puts
// there — an npc's `motivation`, a location's `atmosphere` (decisions/data-shape). One
// save carries what changed, and the caller's editing session turns it into
// its own write. Every other field is deliberately not part of this surface:
// the status control and the dialog own those, and a request that does not
// name them leaves them untouched — a forced save included (decisions/writes).
//
// Everything in this module is pure, so the rules are unit-testable.

/** One save of the edit surface: the text, and the change of the prose fields that moved. */
export interface BodyEditChange<F extends object = Record<string, unknown>> {
  body?: string;
  fields?: F;
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
 * The one save of the edit surface: each part only when it CHANGED. The text
 * travels when it differs from the baseline, the prose fields as the change
 * of the ones that moved. An empty change means there is nothing to save.
 *
 * Only-what-changed is what keeps a forced save honest: it resends this change
 * on top of the stored row, so a part the DM did not touch must not be in it
 * — a text write must not reset a `motivation` somebody else just wrote.
 */
export function bodyEditorChange<F extends object>(
  baseline: string,
  body: string,
  fieldsChange?: F,
): BodyEditChange<F> {
  return {
    ...(hasBodyChanges(baseline, body) ? { body } : {}),
    ...(fieldsChange !== undefined && Object.keys(fieldsChange).length > 0
      ? { fields: fieldsChange }
      : {}),
  };
}

/** Does a change carry anything? */
export function hasBodyEditChange(change: BodyEditChange<object>): boolean {
  return change.body !== undefined || change.fields !== undefined;
}
