// Editing a file's markdown body from the reading view (issue #15, ADR #11:
// pflegen aus der App, der externe Editor ist nur noch das Ventil).
//
// Frontmatter is deliberately NOT part of this: the status regler (#28), the
// campaign metadata dialog (#34) and the rename cascade (#30) own the
// structured fields. Here the DM edits prose — PUT /file replaces the body and
// leaves the frontmatter block byte-identical.
//
// Everything in this module is pure or a plain API call (no react, no query
// imports), so the rules are unit-testable.

import type { EntityKind, FileResponse } from "@grimoire/shared/types";

import { fetchFile, putFileBody } from "@/api";
// The conflict message and its 409 test are the app's ONE wording for "the
// file moved under you" — they live with the scene-status write flow that
// first needed them (campaign-meta.ts borrows them the same way).
import { STALE_FILE_MESSAGE, isStaleFileError } from "@/lib/scene-status";

export { STALE_FILE_MESSAGE };

/** Shown inline (no toast) when the write failed for any other reason. */
export const SAVE_FAILED_MESSAGE = "Nicht gespeichert — Server prüfen";

/**
 * Whether the reading view offers „Bearbeiten" for a kind.
 *
 *   session / inbox  no — append-only by design (ADR #4, issues #9/#11); a
 *                    free-hand rewrite of a log is not a maintenance action.
 *   campaign         no — its header already carries „Bearbeiten" for name and
 *                    description (issue #34); one label, one meaning.
 *   everything else  yes: scene, npc, location, chapter (_chapter.md),
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
 * poll refetches the file while the DM types, and inheriting its mtime would
 * turn a foreign edit into a silent overwrite instead of a 409. But not every
 * new version is a foreign EDIT — the status regler stays usable while the
 * editor is open (issue #28) and its PATCH bumps the mtime without touching a
 * byte of the body. Inheriting exactly those keeps the DM's own status change
 * from answering the next „Speichern" with „Datei extern geändert".
 *
 * The rule is therefore: same path, different version, IDENTICAL body. A write
 * that changed only frontmatter (from anywhere) is folded in as well, which is
 * correct — PUT /file keeps whatever frontmatter is on disk, so there is
 * nothing for a body write to conflict with.
 */
export function shouldAdvanceBase(base: FileResponse, incoming: FileResponse | undefined): boolean {
  if (incoming === undefined) return false;
  if (incoming.path !== base.path) return false; // another file entirely
  if (incoming.mtimeMs === base.mtimeMs) return false; // same version, nothing to do
  return incoming.body === base.body;
}

export type FileBodyWriteResult =
  /** Written: the server's fresh file, ready to seed into the query cache. */
  | { ok: true; file: FileResponse }
  /**
   * NOT written — the file changed on disk. `file` is the re-read file when
   * the reload succeeded (its mtime makes the next attempt work); undefined
   * when even the reload failed.
   */
  | { ok: false; file?: FileResponse };

/**
 * Write the body. On a 409 nothing was written: the file is re-read so the
 * view knows the current state and the next „Speichern" carries the fresh
 * mtime — the DM's text stays in the editor either way (the caller keeps it).
 * Every other failure throws.
 */
export async function writeFileBody(
  campaign: string,
  path: string,
  body: string,
  mtimeMs: number,
): Promise<FileBodyWriteResult> {
  try {
    const file = await putFileBody(campaign, path, body, mtimeMs);
    return { ok: true, file };
  } catch (error) {
    if (!isStaleFileError(error)) throw error;
    try {
      return { ok: false, file: await fetchFile(campaign, path) };
    } catch {
      // The reload failed too (server gone): the conflict message stands,
      // the cache keeps the file we had and the normal queries retry.
      return { ok: false };
    }
  }
}
