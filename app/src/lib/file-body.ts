// Editing a file's markdown body from the reading view (issue #15, ADR #11:
// pflegen aus der App, der externe Editor ist nur noch das Ventil).
//
// Properties is deliberately NOT part of this: the status regler (#28), the
// campaign metadata dialog (#34) and the rename cascade (#30) own the
// structured fields. Here the DM edits prose — PUT /file replaces the body and
// leaves the properties block byte-identical.
//
// Everything in this module is pure or a plain API call (no react, no query
// imports), so the rules are unit-testable.

import type { EntityKind, FileResponse } from "@grimoire/shared/types";

import { fetchFile, putFileBody } from "@/api";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

/**
 * Whether the reading view offers „Bearbeiten" for a kind.
 *
 *   session / inbox  no — append-only by design (ADR #4, issues #9/#11); a
 *                    free-hand rewrite of a log is not a maintenance action.
 *   campaign         no — its header already carries „Bearbeiten" for name and
 *                    description (issue #34); one label, one meaning.
 *   everything else  yes: scene, npc, location, chapter (_chapter),
 *                    glossary and whatever else the route is pointed at.
 */
export function canEditFileBody(kind: EntityKind): boolean {
  switch (kind) {
    case "session":
    case "inbox":
    case "campaign":
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
 * Two callers, one rule: the save button is dead without changes, and
 * „Abbrechen" only asks for confirmation when there is work to lose.
 */
export function hasBodyChanges(original: string, draft: string): boolean {
  return draft !== original;
}

/**
 * May the open editor adopt `incoming` as the version it writes against?
 *
 * The editor freezes the version it was seeded from on purpose: the 5s version
 * poll refetches the file while the DM types, and inheriting its rev would
 * turn a foreign edit into a silent overwrite instead of a 409. But not every
 * new version is a foreign EDIT — the status regler stays usable while the
 * editor is open (issue #28) and its PATCH bumps the rev without touching a
 * byte of the body. Inheriting exactly those keeps the DM's own status change
 * from answering the next „Speichern" with „Inzwischen geändert".
 *
 * The rule is therefore: same path, different version, IDENTICAL body. A write
 * that changed only properties (from anywhere) is folded in as well, which is
 * correct — PUT /file keeps whatever properties is on disk, so there is
 * nothing for a body write to conflict with.
 */
export function shouldAdvanceBase(base: FileResponse, incoming: FileResponse | undefined): boolean {
  if (incoming === undefined) return false;
  if (incoming.path !== base.path) return false; // another file entirely
  if (incoming.rev === base.rev) return false; // same version, nothing to do
  return incoming.body === base.body;
}

/**
 * Write the body. The 409 handling is the shared protocol of
 * write-with-rev.ts: nothing was written, the file is re-read so the view
 * knows the current state and the next „Speichern" carries the fresh rev —
 * the DM's text stays in the editor either way (the caller keeps it). Every
 * other failure throws.
 */
export function writeFileBody(
  campaign: string,
  path: string,
  body: string,
  rev: number,
): Promise<RevWriteResult> {
  return writeWithRev(
    () => putFileBody(campaign, path, body, rev),
    () => fetchFile(campaign, path),
  );
}
