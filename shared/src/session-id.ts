// The shape of a session ID, defined ONCE — for the same reason
// ./session-state exists: server and app both have to order session ids, and
// two hand-rolled variants disagree the moment a day holds ten sessions.
//
// A session id is `yyyy-mm-dd` for the day's FIRST session and
// `yyyy-mm-dd-<n>` (n >= 2) for every further one (issue #58): the identity
// left the calendar day when "beenden" became final, but stays readable and
// needs no migration of the rows that were written as plain dates.
//
// The consequence nobody may re-derive locally: `-10` is NEWER than `-2`, but
// as a STRING it sorts before it. Every comparison of session ids goes through
// `compareSessionIdsNewestFirst` (or the two accessors below), never through
// `<` on the raw id.

const SESSION_ID = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/;

/** The date part of a session id, or undefined for a degraded id. */
export function sessionIdDate(id: string): string | undefined {
  return SESSION_ID.exec(id)?.[1];
}

/**
 * The sequence number inside its day: 1 for `yyyy-mm-dd`, n for `-n`, and 0
 * for an id that does not parse at all (which then loses every comparison).
 */
export function sessionIdSeq(id: string): number {
  const m = SESSION_ID.exec(id);
  if (m === null) return 0;
  return m[2] === undefined ? 1 : Number(m[2]);
}

/**
 * Newest-first comparator for two session IDS ALONE — the date part decides
 * (as a string, which is date order for `yyyy-mm-dd`), the numeric sequence
 * number breaks the tie. A degraded id has no date and no sequence, so it
 * ranks behind every parsable one; two degraded ids fall back to a stable
 * string compare so the order never depends on the input order.
 *
 * The server has row data (`started`) and therefore a richer comparator on
 * top of this one (store/read.ts `compareSessionsNewestFirst`); the app only
 * ever sees the id.
 */
export function compareSessionIdsNewestFirst(a: string, b: string): number {
  const da = sessionIdDate(a);
  const db = sessionIdDate(b);
  if (da !== db) {
    if (da === undefined) return 1;
    if (db === undefined) return -1;
    return db < da ? -1 : 1;
  }
  if (da === undefined) return a < b ? -1 : a > b ? 1 : 0;
  return sessionIdSeq(b) - sessionIdSeq(a);
}
