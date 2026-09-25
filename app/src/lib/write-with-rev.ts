// The conflict protocol of ADR #4, in one place.
//
// Every write the app does carries the guard token of the row the DM was
// looking at, so a competing write answers 409 instead of being overwritten
// silently. The 409 is not an error the user has to fix: nothing was written,
// so the row is re-read once and the NEXT attempt carries the fresh token.
//
// `rev` is the row's VERSION — an opaque token, which is all this module
// treats it as, and one that two writes can never share.
//
// The status controls of a scene and a chapter share exactly that shape. What
// differs is only the request and the row it answers with; the conflict
// handling is this module. Pure, no react, no query imports.

import { ApiError } from "@/api";
import type { MessageKey } from "@/i18n";

/** True for the server's write conflict (409) — someone else wrote first. */
export function isWriteConflict(error: unknown): boolean {
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
export const STALE_MESSAGE: MessageKey = "write.stale";

/**
 * Shown inline when a write failed for any reason OTHER than a conflict — the
 * default wording of every write path; a path with a narrower noun overrides
 * it, like the status control's own message.
 */
export const WRITE_FAILED_MESSAGE: MessageKey = "write.failed";

export type RevWriteResult<T> =
  /** Written: the server's fresh row, ready to seed into the query cache. */
  | { ok: true; row: T }
  /**
   * NOT written — the row changed on the server (or appeared while a dialog
   * was open). `row` is the re-read row when the reload succeeded (its rev
   * makes the next attempt work); undefined when even the reload failed.
   */
  | { ok: false; row?: T };

/**
 * Run one rev-checked write. `write` is the API call including the rev;
 * `reread` fetches the row the write was aimed at and is only used after a
 * 409. Every failure that is NOT a conflict throws — the caller's inline error
 * line belongs to those.
 */
export async function writeWithRev<T>(
  write: () => Promise<T>,
  reread: () => Promise<T>,
): Promise<RevWriteResult<T>> {
  try {
    return { ok: true, row: await write() };
  } catch (error) {
    if (!isWriteConflict(error)) throw error;
    try {
      return { ok: false, row: await reread() };
    } catch {
      // The reload failed too (server gone): the conflict message stands and
      // the cache keeps the row we had — the version poll brings the current
      // one as soon as the server answers again.
      return { ok: false };
    }
  }
}

/**
 * Bind a write to the version it is checked against — the "is there a rev
 * at all?" dance, once.
 *
 * A status control can only write once the row on screen has been read;
 * `undefined` means "nothing to write against yet".
 * Returning NO write function for that case is what makes it one place: the
 * hook already ignores a call it cannot serve, so no caller needs its own
 * early return plus an unreachable `throw` for TypeScript's benefit. The
 * narrowed number is handed to `write` as an argument, so the narrowing
 * survives the closure.
 */
export function withRev<TVariables, T>(
  rev: number | undefined,
  write: (variables: TVariables, rev: number) => Promise<RevWriteResult<T>>,
): ((variables: TVariables) => Promise<RevWriteResult<T>>) | undefined {
  if (rev === undefined) return undefined;
  return (variables: TVariables) => write(variables, rev);
}
