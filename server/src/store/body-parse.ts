// The identity of one session log row.
//
// One thing lives here: `logLineId`, the short hash that IS a log row's id.
// The log append (store/sessions.ts), the seed (db/seed.ts) and the review action
// have to compute it exactly the same way, so they all compute it here.
//
// It hashes the row's CANONICAL LINE — `- HH:MM (scene-id) text`, the three
// content columns in one deterministic string. The columns are the stored
// truth (the row holds no line of its own), and the canonical form is what
// makes the id reproducible from them: a row keeps the id it has had since it
// was written, because that spelling is the one the id was always taken over.
//
// There is no text-to-columns parser any more. Every column of the storage is
// written as a field or as a list row through its own endpoint (ADR #23, #26);
// a body is stored as it was typed and is never read back into rows.

import { createHash } from "node:crypto";

/**
 * Eight hex characters of sha256 — short enough to read, wide enough to key.
 *
 * Exported because the review action still names a log line by the line
 * itself: it hashes what it was sent and looks the row up by that id. A line
 * in the canonical spelling below therefore finds its row.
 */
export function logLineShortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/**
 * The canonical line of one log row: its time, the scene it names and its
 * text, in the one spelling the id is taken over. Not a storage format and
 * not answered anywhere — it exists so the id below is a function of the
 * columns.
 */
export function logLineCanonical(
  at: string | null,
  sceneId: string | null,
  text: string,
): string {
  const time = at === null || at === "" ? "" : `${at} `;
  const scene = sceneId === null || sceneId === "" ? "" : `(${sceneId}) `;
  return `- ${time}${scene}${text}`;
}

/**
 * The id of one log row — what `SessionLogEntry.id` carries and what
 * `POST /review/seen` names a line by.
 *
 * Two rows of one session CAN collide: the same note text, in the same
 * minute, in the same scene is the same canonical line. Marking one of them
 * as seen then marks the first of the two, which is what the review meant
 * before the columns existed as well.
 */
export function logLineId(at: string | null, sceneId: string | null, text: string): string {
  return logLineShortHash(logLineCanonical(at, sceneId, text));
}
