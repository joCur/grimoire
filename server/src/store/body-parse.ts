// Parsing pieces of an entry's BODY — the text side of the store.
//
// One thing lives here: `logLineShortHash`, the short hash of a raw session
// log line. It is the identity the review's `reviewed` flag is keyed by, so
// the log append (store/write.ts) and the review action have to compute it
// exactly the same way.
//
// There is no text-to-columns parser any more. Every column of the storage is
// written as a field or as a list row through its own endpoint (ADR #23); a
// body is stored as it was typed and is never read back into rows.

import { createHash } from "node:crypto";

/**
 * Short hash of one raw session log line — the key the review's `reviewed`
 * flag hangs on. Eight hex characters of sha256 over the line as stored.
 */
export function logLineShortHash(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
}
