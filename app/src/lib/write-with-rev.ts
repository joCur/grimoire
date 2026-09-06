// The conflict protocol of ADR #4, in one place (issue #38).
//
// Every write the app does carries the guard token of the FileResponse the DM
// was looking at, so a competing write answers 409 instead of being
// overwritten silently. The 409 is not an error the user has to fix: nothing
// was written, so the file is re-read once and the NEXT attempt carries the
// fresh token.
//
// The wire field is still called `rev`, but since the SQLite cutover
// (issue #57) it carries the row's VERSION, not a file rev — an opaque
// token, which is all this module ever treated it as. The upgrade is real
// though: two writes inside the same second used to share a rev and both
// went through (issue #37); two writes cannot share a row version.
//
// Three write paths share exactly that shape — the status regler (#28), the
// campaign metadata dialog (#34) and the body editor (#15). What differs is
// only the request itself; the conflict handling is this module. Pure, no
// react, no query imports.

import type { FileResponse } from "@grimoire/shared/types";

import { ApiError } from "@/api";

/** True for the server's write conflict (409) — someone else wrote first. */
export function isStaleFileError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/**
 * Shown inline (no toast) after a conflict; the next attempt uses the fresh
 * token. The wording no longer says "extern": after the cutover the other
 * writer is another tab, the generator or a second request — not an editor
 * on the file system, which does not exist any more.
 */
export const STALE_FILE_MESSAGE = "Inzwischen geändert — neu laden";

/**
 * Shown inline when a write failed for any reason OTHER than a conflict — the
 * default wording of every write path (a path with a narrower noun overrides
 * it, e.g. the status regler's „Status nicht gespeichert").
 */
export const WRITE_FAILED_MESSAGE = "Nicht gespeichert — Server prüfen";

export type RevWriteResult =
  /** Written: the server's fresh file, ready to seed into the query cache. */
  | { ok: true; file: FileResponse }
  /**
   * NOT written — the file changed on disk (or appeared while a dialog was
   * open). `file` is the re-read file when the reload succeeded (its rev
   * makes the next attempt work); undefined when even the reload failed.
   */
  | { ok: false; file?: FileResponse };

/**
 * Run one rev-checked write. `write` is the API call including the rev;
 * `reread` fetches the file the write was aimed at and is only used after a
 * 409. Every failure that is NOT a conflict throws — the caller's inline error
 * line belongs to those.
 */
export async function writeWithRev(
  write: () => Promise<FileResponse>,
  reread: () => Promise<FileResponse>,
): Promise<RevWriteResult> {
  try {
    return { ok: true, file: await write() };
  } catch (error) {
    if (!isStaleFileError(error)) throw error;
    try {
      return { ok: false, file: await reread() };
    } catch {
      // The reload failed too (server gone): the conflict message stands and
      // the cache keeps the file we had — the version poll (issue #8) brings
      // the current one as soon as the server answers again.
      return { ok: false };
    }
  }
}

/**
 * Bind a write to the version it is checked against — the "is there a rev
 * at all?" dance, once.
 *
 * Two paths (the status regler, the body editor) can only write when the file
 * on screen has been read; `undefined` means "nothing to write against yet".
 * Returning NO write function for that case is what makes it one place: the
 * hook already ignores a call it cannot serve, so neither path needs its own
 * early return plus an unreachable `throw` for TypeScript's benefit. The
 * narrowed number is handed to `write` as an argument, so the narrowing
 * survives the closure.
 */
export function withRev<TVariables>(
  rev: number | undefined,
  write: (variables: TVariables, rev: number) => Promise<RevWriteResult>,
): ((variables: TVariables) => Promise<RevWriteResult>) | undefined {
  if (rev === undefined) return undefined;
  return (variables: TVariables) => write(variables, rev);
}
