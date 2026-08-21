// The mtime protocol of ADR #4, in one place (issue #38).
//
// Every write the app does carries the mtime of the FileResponse the DM was
// looking at, so an external edit answers 409 instead of being overwritten
// silently. The 409 is not an error the user has to fix: nothing was written,
// so the file is re-read once and the NEXT attempt carries the fresh mtime.
//
// Three write paths share exactly that shape — the status regler (#28), the
// campaign metadata dialog (#34) and the body editor (#15). What differs is
// only the request itself; the conflict handling is this module. Pure, no
// react, no query imports.

import type { FileResponse } from "@grimoire/shared/types";

import { ApiError } from "@/api";

/** True for the server's mtime conflict (409) — the file changed on disk. */
export function isStaleFileError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** Shown inline (no toast) after a conflict; the next attempt uses the fresh mtime. */
export const STALE_FILE_MESSAGE = "Datei extern geändert — neu laden";

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
      // The reload failed too (server gone): the conflict message stands, the
      // cache keeps the file we had and the normal queries retry.
      return { ok: false };
    }
  }
}
