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
