// Injectable clock. All timestamps the write API produces (session ids,
// started/ended, log times) use the server's LOCAL time — the server runs
// where the DM plays (single container, DECISIONS #5). Tests override the
// clock via setNow() to get deterministic dates.

let nowFn: () => Date = () => new Date();

/** Current time — always go through this, never `new Date()` directly. */
export function now(): Date {
  return nowFn();
}

/** Test-only override; pass null to restore the real clock. */
export function setNow(fn: (() => Date) | null): void {
  nowFn = fn ?? (() => new Date());
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-mm-dd` in local time — the session file name / id. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM` in local time — the log line timestamp. */
export function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `yyyy-mm-ddTHH:MM` in local time — the `started`/`ended` format. Matches
 * what the shared parser normalizes YAML timestamps to (no seconds, no zone).
 */
export function localDateTime(d: Date): string {
  return `${localDate(d)}T${localTime(d)}`;
}

/**
 * The inverse of localDateTime: a zone-less `started`/`ended` value as epoch
 * milliseconds, interpreted in the SERVER's timezone (issue #40).
 *
 * The file format stays zone-less on purpose (hand-editable, README), but
 * only the server knows which wall clock those digits belong to — a browser
 * in another timezone would compute a session runtime that is hours off. So
 * the server ships the interpretation alongside the string (FileResponse
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
