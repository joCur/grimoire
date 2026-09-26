// Which sentence a failed review of a log entry shows. A 409 is no failure of
// the server: the entry was changed in the meantime, nothing was written, and
// the session is read again. Every other failure keeps the sentence of its
// surface. Catalog keys only, the copy lives in app/src/i18n.

import type { MessageKey } from "@/i18n";
import { isWriteConflict } from "@/lib/write-with-rev";

/** The sentence of a failed review: the stale one on a 409, else `fallback`. */
export function reviewFailureKey(error: unknown, fallback: MessageKey): MessageKey {
  return isWriteConflict(error) ? "session.log.review.stale" : fallback;
}
