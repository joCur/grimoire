// Local wall-clock strings, and the way back.
//
// Every timestamp the write API produces (session ids, started/ended, log
// times) is the server's LOCAL time — the server runs where the DM plays
// (single container, DECISIONS #5) — and it is written zone-less, as
// `yyyy-mm-dd`, `HH:MM` or `yyyy-mm-ddTHH:MM[:SS]`.
//
// That shape has no native formatter: `toISOString` is UTC, so it shifts the
// digits and appends a `Z` the format does not have, and `toLocaleString` is
// locale-shaped and not sortable. Hence these five functions, and hence the
// inverse at the bottom — nothing native reads a zone-less string as local
// time either.
//
// The time ITSELF is `new Date()` at the call site. A test that needs a fixed
// one fakes the system clock (`setSystemTime` from bun:test), which the whole
// process sees, rather than this module handing out an overridable one.

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-mm-dd` in local time — the id of a session. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM` in local time — the log line timestamp. */
export function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `yyyy-mm-ddTHH:MM` in local time — minute precision, zone-less. The base of
 * `localDateTimeSeconds`; nothing the write API produces stops here any more.
 */
export function localDateTime(d: Date): string {
  return `${localDate(d)}T${localTime(d)}`;
}

/**
 * `yyyy-mm-ddTHH:MM:SS` in local time — the `pauses` timestamps and
 * `started`/`ended`. Same zone-less convention as localDateTime, one field
 * wider: these values are all read back as durations,
 * and a minute-precise value rounds DOWN to the start of its minute — a pause
 * would jump the runtime by up to a minute, and a session started at second 50
 * showed 0:00:50 on the timer's very first tick. The shared parser keeps
 * the seconds on the way back in (parse.ts), and localDateTimeToMs has always
 * accepted them.
 */
export function localDateTimeSeconds(d: Date): string {
  return `${localDateTime(d)}:${pad(d.getSeconds())}`;
}

/**
 * The inverse of localDateTime: a zone-less `started`/`ended` value as epoch
 * milliseconds, interpreted in the SERVER's timezone.
 *
 * The stored string stays zone-less on purpose (README), but
 * only the server knows which wall clock those digits belong to — a browser
 * in another timezone would compute a session runtime that is hours off. So
 * the server ships the interpretation alongside the string (EntryResponse
 * startedMs/endedMs) and the client does plain epoch arithmetic.
 *
 * Accepted: `yyyy-mm-dd[T ]HH:MM(:ss)?` and — deliberately — a DATE-ONLY
 * `yyyy-mm-dd`, which is read as 00:00 local. A session started at exactly
 * midnight is written as `…T00:00`, and the YAML normalization cannot tell
 * that apart from a date-only value (shared/src/parse.ts); treating it as
 * midnight is the reading that keeps the timer alive instead of dropping it
 * silently. Anything unparseable yields undefined.
 */
export function localDateTimeToMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (m === null) return undefined;
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  ).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}
