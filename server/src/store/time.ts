// The one shape a session timestamp has, and the way back from it.
//
// `sessions.started`, `sessions.ended` and the `session_pauses` timestamps are
// zone-less local wall-clock strings — the server runs where the DM plays
// (DECISIONS #5) — and they are second-precise: the values are read back as
// durations, and a minute-precise value rounds DOWN to the start of its
// minute, which would jump a session's runtime by up to a minute per pause.
//
// Writing them is plain formatting with `date-fns` at the call site
// (store/sessions.ts); only the way BACK carries a domain rule, and that is what
// lives here. The time ITSELF is `new Date()` at the call site — a test that
// needs a fixed one fakes the system clock.
//
// The shape is CLOSED, not guessed at: the app is the only writer (ADR #13),
// it writes exactly this format, and the one write that carries a value from
// outside — a session PATCH — refuses any other shape (store/sessions.ts). So
// the reader tolerates no variants — no second-less value, no space instead
// of the `T`, no bare date.

import { format, isValid, parse } from "date-fns";

/**
 * `yyyy-mm-ddTHH:MM:SS` in local time — `started`, `ended` and both ends of a
 * pause. Zone-less and second-precise.
 */
export const LOCAL_DATE_TIME_SECONDS = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * The same shape spelled for a HUMAN — the pattern above with the quoting
 * `date-fns` needs stripped out. It is what the write path's refusal names.
 */
export const LOCAL_DATE_TIME_SHAPE = LOCAL_DATE_TIME_SECONDS.replace(/'/g, "");

/**
 * A stored session timestamp as epoch milliseconds, interpreted in the
 * SERVER's timezone — the inverse of the format above.
 *
 * The stored string stays zone-less on purpose (README), but only the server
 * knows which wall clock those digits belong to — a browser in another
 * timezone would compute a session runtime that is hours off. So the server
 * ships the interpretation alongside the string (EntryResponse
 * startedMs/endedMs) and the client does plain epoch arithmetic.
 *
 * Anything that is not exactly the one shape — a blank `ended`, a value some
 * direct database write left behind — yields undefined, and the caller reads
 * that as "says nothing about when". The exactness comes from formatting the
 * parsed moment back: `date-fns` `parse` alone accepts a one-digit hour and
 * trailing blanks, and the write guard and the reader must agree on ONE shape.
 */
export function localDateTimeToMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parse(value, LOCAL_DATE_TIME_SECONDS, new Date());
  if (!isValid(parsed)) return undefined;
  return format(parsed, LOCAL_DATE_TIME_SECONDS) === value ? parsed.getTime() : undefined;
}
