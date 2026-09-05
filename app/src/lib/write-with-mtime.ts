// The conflict protocol of ADR #4, in one place (issue #38).
//
// Every write the app does carries the guard token of the FileResponse the DM
// was looking at, so a competing write answers 409 instead of being
// overwritten silently. The 409 is not an error the user has to fix: nothing
// was written, so the file is re-read once and the NEXT attempt carries the
// fresh token.
//
// The wire field is still called `mtimeMs`, but since the SQLite cutover
// (issue #57) it carries the row's VERSION, not a file mtime — an opaque
// token, which is all this module ever treated it as. The upgrade is real
// though: two writes inside the same second used to share an mtime and both
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

export type MtimeWriteResult =
  /** Written: the server's fresh file, ready to seed into the query cache. */
  | { ok: true; file: FileResponse }
  /**
   * NOT written — the file changed on disk (or appeared while a dialog was
   * open). `file` is the re-read file when the reload succeeded (its mtime
   * makes the next attempt work); undefined when even the reload failed.
   */
  | { ok: false; file?: FileResponse };

/**
 * Run one mtime-checked write. `write` is the API call including the mtime;
 * `reread` fetches the file the write was aimed at and is only used after a
 * 409. Every failure that is NOT a conflict throws — the caller's inline error
 * line belongs to those.
 */
export async function writeWithMtime(
  write: () => Promise<FileResponse>,
  reread: () => Promise<FileResponse>,
): Promise<MtimeWriteResult> {
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
 * Bind a write to the version it is checked against — the "is there an mtime
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
export function withMtime<TVariables>(
  mtimeMs: number | undefined,
  write: (variables: TVariables, mtimeMs: number) => Promise<MtimeWriteResult>,
): ((variables: TVariables) => Promise<MtimeWriteResult>) | undefined {
  if (mtimeMs === undefined) return undefined;
  return (variables: TVariables) => write(variables, mtimeMs);
}
