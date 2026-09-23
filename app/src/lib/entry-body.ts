// Whether there is anything to save — the rule the edit mode of the reading
// view needs before any write is involved.
//
// Every entry has an editable text: the lists that had none — a session's log,
// the inbox, the glossary — are not entries any more, they have their own
// endpoints and their own views.
//
// The write itself is the shared editing session (lib/use-entry-edit.ts): one
// PATCH per interaction, carrying what this surface changed — the text, and
// the prose properties an npc or a location edits beside it (`motivation`,
// `atmosphere`; @grimoire/shared `FieldSurface`). Every other property is
// deliberately not part of this surface: the status control and the
// properties dialog own those fields, and a request that does not name them
// leaves them untouched — a forced save included (ADR #23).
//
// Everything in this module is pure, so the rules are unit-testable.

import type { EntryWrite } from "@/lib/entry-edit";

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
 * The one write of the edit surface: each half only when it CHANGED. The text
 * travels when it differs from the baseline, the prose properties as the
 * patch of the fields that moved (lib/properties-form.ts `propertiesPatch`).
 * An empty write means there is nothing to save.
 *
 * Only-what-changed is what keeps a forced save honest: it resends this write
 * on top of the stored row, so a half the DM did not touch must not be in it
 * — a text write must not reset a `motivation` somebody else just wrote.
 */
export function bodyEditorWrite(
  baseline: string,
  body: string,
  fieldsPatch: Record<string, unknown>,
): EntryWrite {
  return {
    ...(hasBodyChanges(baseline, body) ? { body } : {}),
    ...(Object.keys(fieldsPatch).length > 0 ? { properties: fieldsPatch } : {}),
  };
}
