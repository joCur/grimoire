// Which sentence a failed tick of an idea shows. A 409 is no failure of the
// server: the idea was changed in the meantime, nothing was written, and the
// ideas are read again — the way the status control reports a stale state.
// Every other failure keeps the sentence of its surface. Catalog keys only,
// the copy lives in app/src/i18n.

import type { MessageKey } from "@/i18n";
import { isWriteConflict } from "@/lib/write-with-rev";

/** The sentence of a failed tick: the stale one on a 409, else `fallback`. */
export function tickFailureKey(error: unknown, fallback: MessageKey): MessageKey {
  return isWriteConflict(error) ? "idea.tick.stale" : fallback;
}
