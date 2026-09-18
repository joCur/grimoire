// Whether there is anything to save — the rule the edit mode of the reading
// view needs before any write is involved.
//
// Every entry has an editable text: the lists that had none — a session's log,
// the inbox, the glossary — are not entries any more, they have their own
// endpoints and their own views.
//
// The write itself is the shared editing session (lib/use-entry-edit.ts): one
// PATCH per interaction, carrying only the text. Properties are deliberately
// not part of this surface — the status control and the properties dialog own
// the structured fields, and a text-only request leaves them untouched.
//
// Everything in this module is pure, so the rules are unit-testable.

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

