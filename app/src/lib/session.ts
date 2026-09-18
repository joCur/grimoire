// Session helpers for the live mode and the session reading page: the
// elapsed timer, the pause arithmetic and the session's readable date. Pure
// functions — unit-tested, no react or query imports here.
//
// There is NO parsing of session text any more: the session endpoints answer
// ROWS (`log`, `pauses`, `scenesPlayed`), so the app reads what it needs
// instead of re-deriving it from a rendered log.
//
// There is no client-side date guessing either: WHICH session is the active
// one is always the server's answer (GET /campaigns/:campaign/session, with
// ?includeEnded=1 for the review — see lib/use-session.ts). A session past
// midnight is YESTERDAY's session, and a browser in another timezone than
// the server would get both the session and the runtime wrong.

import type { SessionResponse } from "@grimoire/shared/types";

import { formatDate, type Translate } from "@/i18n/format";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse `yyyy-mm-ddTHH:MM(:ss)?` as the BROWSER's local time. The session
 * endpoints carry the server's epoch readings, so this is not used for them
 * any more — what is left is the campaign list's `lastSessionStarted`, the one
 * timestamp that arrives as a bare string (lib/campaign.ts). Undefined when
 * the value does not parse.
 *
 * SECONDS are read when present. A DATE-ONLY `yyyy-mm-dd` is read as 00:00 —
 * a session started at exactly midnight is written without a time part, and
 * requiring one would make the value silently unusable at midnight.
 */
export function parseLocalDateTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
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

/**
 * The bit of a session the timer helpers need — so the topbar chip, the live
 * view and the reading page share one set of rules, and a session SUMMARY
 * (which carries no pauses) works with them too.
 */
export interface SessionTimes {
  startedMs: number;
  endedMs?: number;
  pauses?: readonly { fromMs: number; toMs?: number }[];
}

/** Total paused time in milliseconds: the sum of the CLOSED intervals. */
export function sessionPausedMs(session: SessionTimes | undefined): number {
  let sum = 0;
  for (const pause of session?.pauses ?? []) {
    if (pause.toMs === undefined) continue;
    sum += Math.max(0, pause.toMs - pause.fromMs);
  }
  return sum;
}

/**
 * Start of the running pause, or undefined when the session is not paused.
 * The LAST open interval wins — the same rule the server writes with.
 */
export function sessionPausedSinceMs(session: SessionTimes | undefined): number | undefined {
  const open = (session?.pauses ?? []).filter((pause) => pause.toMs === undefined);
  return open[open.length - 1]?.fromMs;
}

/** True while the session is paused — the chip's dimmed state. */
export function sessionIsPaused(session: SessionTimes | undefined): boolean {
  return sessionPausedSinceMs(session) !== undefined;
}

/**
 * True when a session holds NOTHING the DM would miss: no log row and no
 * played scene. Only such a session may be DISCARDED — the same rule the
 * server enforces, so the action is never offered for a 409.
 */
export function sessionIsEmpty(session: SessionResponse): boolean {
  return session.log.length === 0 && session.scenesPlayed.length === 0;
}

/** True when the session is finished — `ended` is set and not blank. */
export function sessionIsEnded(session: Pick<SessionResponse, "ended">): boolean {
  return session.ended !== undefined && session.ended.trim() !== "";
}

/**
 * The session's RUNTIME in milliseconds:
 *
 *     (ended ?? paused-since ?? now) − started − paused
 *
 * Pauses are deducted, and while one runs the clock STANDS: the reference
 * point is then the moment the pause began, so a re-render a minute later
 * shows the same number. `ended` and an open pause together take the earlier
 * of the two, so the value can never grow past the end. Undefined when there
 * is no session.
 */
export function sessionElapsedMs(
  session: SessionTimes | undefined,
  nowMs: number,
): number | undefined {
  if (session === undefined) return undefined;
  const stops = [session.endedMs, sessionPausedSinceMs(session)].filter(
    (v): v is number => v !== undefined,
  );
  const reference = stops.length === 0 ? nowMs : Math.min(...stops);
  return Math.max(0, reference - session.startedMs - sessionPausedMs(session));
}

/**
 * Elapsed time as `H:MM:SS`, clamped at `0:00:00`.
 *
 * The seconds are the point: the session chip is the only proof in the
 * chrome that the evening is still running, and a minutes-only readout that
 * changes every ~15s looks frozen — the DM cannot tell a live clock from a
 * stale render.
 */
export function formatElapsed(startMs: number, nowMs: number): string {
  return formatDuration(nowMs - startMs);
}

/** A duration in milliseconds as `H:MM:SS`, clamped at `0:00:00`. */
export function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
}

/**
 * The session's runtime as `H:MM:SS` — the label the chip shows. Undefined
 * when there is no session to time.
 */
export function sessionElapsedLabel(
  session: SessionTimes | undefined,
  nowMs: number,
): string | undefined {
  const ms = sessionElapsedMs(session, nowMs);
  return ms === undefined ? undefined : formatDuration(ms);
}

/**
 * The session's HEADING — its date.
 *
 * The session id is an opaque random string, so everything displayable about
 * a session is derived from `started`. Formatted from the wall-clock digits of
 * the string itself, not via `Date` and `toLocaleDateString`: the value is
 * zone-less on purpose (README), and re-reading it in the browser's timezone
 * is how a session that started at 23:30 ends up dated the next day.
 *
 * Falls back to the bare word when there is no usable `started` — the honest
 * answer, and better than the raw id, which is 36 characters of noise.
 */
export function sessionDateLabel(
  session: { started?: string } | undefined,
  t: Translate,
): string {
  const started = session?.started;
  const m = typeof started === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(started.trim()) : null;
  if (m === null) return t("session.date.unknown");
  // The DATE itself goes through `Intl` in the selected language:
  // `13.09.2026` in German, `09/13/2026` in English. Built from the
  // zone-less parts as a LOCAL date, so the day never shifts by a timezone.
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return t("session.date", { date: formatDate(t.locale, date) });
}

/**
 * The wall-clock time of a session timestamp as `HH:MM` — what the reading
 * page puts next to "started" and "ended". Taken from the string's own digits
 * for the same reason the date label is. Undefined when there is no time part.
 */
export function sessionTimeLabel(value: string | undefined): string | undefined {
  const m = typeof value === "string" ? /[T ](\d{1,2}):(\d{2})/.exec(value.trim()) : null;
  return m === null ? undefined : `${pad(Number(m[1]))}:${m[2] ?? "00"}`;
}
