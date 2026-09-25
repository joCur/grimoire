// The one shape a session timestamp has, and the way back from it.
//
// `sessions.started`, `sessions.ended` and the two ends of a pause are
// zone-less local wall-clock strings — read in the timezone of the server —,
// and they are second-precise: the values are read back as durations, and a
// minute-precise value rounds DOWN to the start of its minute, which would
// jump a session's runtime by up to a minute per pause.
//
// Writing them is plain formatting with `date-fns`, either of the server's
// clock at the call site (store/sessions.ts, store/pauses.ts) or of an epoch
// value from the wire (`epochToLocalDateTime` below). A test that needs a
// fixed time fakes the system clock.
//
// The shape is CLOSED, not guessed at: the server is the only writer and
// writes exactly this format, so the reader tolerates no variants — no
// second-less value, no space instead of the `T`, no bare date.

import { format, isValid, parse } from "date-fns";

/**
 * `yyyy-mm-ddTHH:MM:SS` in local time — `started`, `ended` and both ends of a
 * pause. Zone-less and second-precise.
 */
export const LOCAL_DATE_TIME_SECONDS = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * An epoch value from the wire as the stored wall-clock string, read in the
 * SERVER's timezone — how a client writes a moment it can only name as a
 * number.
 */
export function epochToLocalDateTime(ms: number): string {
  return format(new Date(ms), LOCAL_DATE_TIME_SECONDS);
}

/**
 * A stored session timestamp as epoch milliseconds, interpreted in the
 * SERVER's timezone — the inverse of the format above.
 *
 * The stored string stays zone-less on purpose (README), but only the server
 * knows which wall clock those digits belong to — a browser in another
 * timezone would compute a session runtime that is hours off. So the server
 * ships the interpretation alongside the string (a session's
 * `startedMs`/`endedMs`, a pause's `fromMs`/`toMs`) and the client does plain
 * epoch arithmetic.
 *
 * Anything that is not exactly the one shape — a blank `ended`, a value some
 * direct database write left behind — yields undefined, and the caller reads
 * that as "says nothing about when". The exactness comes from formatting the
 * parsed moment back: `date-fns` `parse` alone accepts a one-digit hour and
 * trailing blanks, and the writer and the reader must agree on ONE shape.
 */
export function localDateTimeToMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parse(value, LOCAL_DATE_TIME_SECONDS, new Date());
  if (!isValid(parsed)) return undefined;
  return format(parsed, LOCAL_DATE_TIME_SECONDS) === value ? parsed.getTime() : undefined;
}
