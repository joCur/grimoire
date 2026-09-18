// Reading a zone-less local wall-clock string back as a moment in time.
//
// Every timestamp the write API produces (session ids, started/ended, log
// times) is the server's LOCAL time — the server runs where the DM plays
// (single container, DECISIONS #5) — and it is written zone-less, as
// `yyyy-mm-dd`, `HH:MM` or `yyyy-mm-ddTHH:MM[:SS]`. Writing those shapes is
// plain formatting and belongs to `date-fns` at the call site
// (LOCAL_DATE, LOCAL_TIME, LOCAL_DATE_TIME_SECONDS below); only the way BACK
// carries domain rules, and that is what stays here.
//
// The time ITSELF is `new Date()` at the call site. A test that needs a fixed
// one fakes the system clock (`setSystemTime` from bun:test), which the whole
// process sees, rather than this module handing out an overridable one.

import { isValid, parse } from "date-fns";

/** `yyyy-mm-dd` in local time — the calendar day of a session. */
export const LOCAL_DATE = "yyyy-MM-dd";

/** `HH:MM` in local time — the log line timestamp. */
export const LOCAL_TIME = "HH:mm";

/**
 * `yyyy-mm-ddTHH:MM:SS` in local time — the `pauses` timestamps and
 * `started`/`ended`. Zone-less, and second-precise on purpose: these values
 * are all read back as durations, and a minute-precise value rounds DOWN to
 * the start of its minute — a pause would jump the runtime by up to a minute,
 * and a session started at second 50 showed 0:00:50 on the timer's very first
 * tick. The shared parser keeps the seconds on the way back in (parse.ts),
 * and localDateTimeToMs has always accepted them.
 */
export const LOCAL_DATE_TIME_SECONDS = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * The shapes localDateTimeToMs accepts, most specific first: a zone-less
 * date-and-time with or without seconds, `T` or a space between the halves,
 * and a one- or two-digit hour.
 */
const READABLE = [
  "yyyy-MM-dd'T'H:mm:ss",
  "yyyy-MM-dd H:mm:ss",
  "yyyy-MM-dd'T'H:mm",
  "yyyy-MM-dd H:mm",
  "yyyy-MM-dd",
] as const;

/**
 * A zone-less `started`/`ended` value as epoch milliseconds, interpreted in
 * the SERVER's timezone — the inverse of the formats above.
 *
 * The stored string stays zone-less on purpose (README), but
 * only the server knows which wall clock those digits belong to — a browser
 * in another timezone would compute a session runtime that is hours off. So
 * the server ships the interpretation alongside the string (EntryResponse
 * startedMs/endedMs) and the client does plain epoch arithmetic.
 *
 * A DATE-ONLY `yyyy-mm-dd` is read — deliberately — as 00:00 local. A session
 * started at exactly midnight is written as `…T00:00:00`, and the
 * normalization cannot tell that apart from a date-only value
 * (shared/src/parse.ts); treating it as midnight is the reading that keeps the
 * timer alive instead of dropping it silently. Anything unparseable yields
 * undefined.
 */
export function localDateTimeToMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  for (const shape of READABLE) {
    const d = parse(trimmed, shape, new Date());
    if (isValid(d)) return d.getTime();
  }
  return undefined;
}
