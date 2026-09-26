// What the text editor of a reading view saves — the rules it needs before
// any write is involved.
//
// The surface edits the text alone. One save carries the text when it
// changed, and the caller's editing session turns it into its own write.
// Every other field is deliberately not part of this surface: the status
// control and the dialog own those, and a request that does not name them
// leaves them untouched — a forced save included (decisions/writes).
//
// Everything in this module is pure, so the rules are unit-testable.

/** One save of the text editor: the text, when it changed. */
export interface BodyEditChange {
  body?: string;
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
 * The one save of the text editor: the text only when it CHANGED. An empty
 * change means there is nothing to save, and a forced save resends only what
 * changed, so a field somebody else just wrote stays.
 */
export function bodyEditorChange(baseline: string, body: string): BodyEditChange {
  return hasBodyChanges(baseline, body) ? { body } : {};
}

/** Does a change carry anything? */
export function hasBodyEditChange(change: BodyEditChange): boolean {
  return change.body !== undefined;
}
