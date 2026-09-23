// The conflict protocol of ADR #4, in one place.
//
// Every write the app does carries the guard token of the Entry the DM
// was looking at, so a competing write answers 409 instead of being
// overwritten silently. The 409 is not an error the user has to fix: nothing
// was written, so the entry is re-read once and the NEXT attempt carries the
// fresh token.
//
// `rev` is the row's VERSION — an opaque token, which is all this module
// treats it as, and one that two writes can never share.
//
// Three write paths share exactly that shape — the status control, the
// campaign dialog and the body editor. What differs is only the request
// itself; the conflict handling is this module. Pure, no react, no query
// imports.

import type { Entry } from "@grimoire/shared/types";

import { ApiError } from "@/api";
import type { MessageKey } from "@/i18n";

/** True for the server's write conflict (409) — someone else wrote first. */
export function isStaleEntryError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/**
 * Shown inline (no toast) after a conflict; the next attempt uses the fresh
 * token. CATALOG KEYS — the copy lives in app/src/i18n, this layer only names
 * which sentence a path uses.
 *
 * The other writer is another tab, the generator or a second request: since
 * ADR #13 there is no writer outside the app.
 */
export const STALE_FILE_MESSAGE: MessageKey = "write.stale";

/**
 * Shown inline when a write failed for any reason OTHER than a conflict — the
 * default wording of every write path; a path with a narrower noun overrides
 * it, like the status control's own message.
 */
export const WRITE_FAILED_MESSAGE: MessageKey = "write.failed";

export type RevWriteResult =
  /** Written: the server's fresh entry, ready to seed into the query cache. */
  | { ok: true; entry: Entry }
  /**
   * NOT written — the entry changed on the server (or appeared while a dialog
   * was open). `entry` is the re-read entry when the reload succeeded (its rev
   * makes the next attempt work); undefined when even the reload failed.
   */
  | { ok: false; entry?: Entry };

/**
 * Run one rev-checked write. `write` is the API call including the rev;
 * `reread` fetches the entry the write was aimed at and is only used after a
 * 409. Every failure that is NOT a conflict throws — the caller's inline error
 * line belongs to those.
 */
export async function writeWithRev(
  write: () => Promise<Entry>,
  reread: () => Promise<Entry>,
): Promise<RevWriteResult> {
  try {
    return { ok: true, entry: await write() };
  } catch (error) {
    if (!isStaleEntryError(error)) throw error;
    try {
      return { ok: false, entry: await reread() };
    } catch {
      // The reload failed too (server gone): the conflict message stands and
      // the cache keeps the entry we had — the version poll brings the
      // current one as soon as the server answers again.
      return { ok: false };
    }
  }
}

/**
 * Bind a write to the version it is checked against — the "is there a rev
 * at all?" dance, once.
 *
 * Two paths (the status regler, the body editor) can only write when the entry
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
