// Which entries the reading view lets the DM edit, and whether there is
// anything to save — the two rules the edit mode of the reading view needs
// before any write is involved.
//
// The write itself is the shared editing session (lib/use-entry-edit.ts): one
// PATCH per interaction, carrying only the text. Properties are deliberately
// not part of this surface — the status control and the properties dialog own
// the structured fields, and a text-only request leaves them untouched.
//
// Everything in this module is pure, so the rules are unit-testable.

import type { EntityKind } from "@grimoire/shared/types";

/**
 * Whether the reading view offers its edit action for a kind.
 *
 *   session / inbox  no — append-only by design (ADR #4); a
 *                    free-hand rewrite of a log is not a maintenance action.
 *   glossary         no — it is a list, maintained row by row on its own page;
 *                    the write path refuses a body for it with 400
 *                    `body_not_editable` (ADR #23), so an editor here could
 *                    only ever lose the typed text.
 *   everything else  yes: scene, npc, location, chapter, the campaign entry
 *                    (its text is prose like a chapter's; name and
 *                    description stay with the campaign dialog) and whatever
 *                    else the route is pointed at.
 */
export function canEditEntryBody(kind: EntityKind): boolean {
  switch (kind) {
    case "session":
    case "inbox":
    case "glossary":
      return false;
    default:
      return true;
  }
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

