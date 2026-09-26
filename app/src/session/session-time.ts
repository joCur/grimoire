// The clock of a session for the live mode and the reading page: the
// runtime, the pause arithmetic and the session's readable date and times.
// Pure functions — unit-tested, no react or query imports here.
//
// Every runtime is computed from the SERVER's epoch readings (`startedMs`,
// `endedMs`, a pause's `fromMs`/`toMs`): the stored timestamps are zone-less,
// and only the server knows which wall clock they belong to. A browser in
// another timezone than the server would otherwise get the runtime hours
// wrong. The readable date and times, on the other hand, are the digits of the
// zone-less strings themselves, read as local — re-reading them in the
// browser's timezone is how a session that started at 23:30 ends up dated the
// next day.

import type { Pause } from "@grimoire/shared/pause";
import type { Session } from "@grimoire/shared/session";
import { format, isValid, parseISO } from "date-fns";

import { formatDate, type Translate } from "@/i18n/format";

/**
 * The bit of a session the clock needs — so the topbar chip, the live view
 * and the reading page share one set of rules.
 *
 * Every epoch reading is optional, exactly as the resource answers them: the
 * server puts one beside a timestamp only when it could read that timestamp. A
 * session without a readable start has no runtime, and that is the honest
 * answer rather than a clock counting from 1970.
 */
export interface SessionTimes {
  startedMs?: Session["startedMs"];
  endedMs?: Session["endedMs"];
  pauses?: readonly Pick<Pause, "fromMs" | "toMs">[];
}

/**
 * Total paused time in milliseconds: the sum of the CLOSED pauses whose wall
 * clock the server could read. A pause without an epoch reading contributes
 * nothing rather than an invented number.
 */
export function sessionPausedMs(session: SessionTimes | undefined): number {
  let sum = 0;
  for (const pause of session?.pauses ?? []) {
    if (pause.toMs === undefined || pause.fromMs === undefined) continue;
    sum += Math.max(0, pause.toMs - pause.fromMs);
  }
  return sum;
}

/**
 * Start of the running pause, or undefined when the session is not paused.
 * The LAST open pause wins — the same rule the server writes with.
 */
export function sessionPausedSinceMs(session: SessionTimes | undefined): number | undefined {
  const open = (session?.pauses ?? []).filter((pause) => pause.toMs === undefined);
  return open[open.length - 1]?.fromMs;
}

/** True while the session is paused — the chip's dimmed state. */
export function sessionIsPaused(session: SessionTimes | undefined): boolean {
  return sessionPausedSinceMs(session) !== undefined;
}

/** The pause that is running, or undefined — what "Weiter" ends. */
export function openPause(session: Pick<Session, "pauses">): Pause | undefined {
  return session.pauses.filter((pause) => pause.to === undefined).at(-1);
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
 * is no session, and when its start carries no epoch reading — there is
 * nothing to count from.
 */
export function sessionElapsedMs(
  session: SessionTimes | undefined,
  nowMs: number,
): number | undefined {
  const startedMs = session?.startedMs;
  if (startedMs === undefined) return undefined;
  const stops = [session?.endedMs, sessionPausedSinceMs(session)].filter(
    (v): v is number => v !== undefined,
  );
  const reference = stops.length === 0 ? nowMs : Math.min(...stops);
  return Math.max(0, reference - startedMs - sessionPausedMs(session));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A duration in milliseconds as `H:MM:SS`, clamped at `0:00:00`.
 *
 * The seconds are the point: the session chip is the only proof in the
 * chrome that the evening is still running, and a minutes-only readout that
 * changes every ~15s looks frozen — the DM cannot tell a live clock from a
 * stale render.
 */
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
 * a session is derived from `started`, read as the local date its digits say.
 * The date itself goes through `Intl` in the selected language: `13.09.2026`
 * in German, `09/13/2026` in English.
 *
 * Falls back to the bare word when there is no usable `started` — the honest
 * answer, and better than the raw id, which is 36 characters of noise.
 */
export function sessionDateLabel(
  session: { started?: string } | undefined,
  t: Translate,
): string {
  const date = parseISO(session?.started ?? "");
  if (!isValid(date)) return t("session.date.unknown");
  return t("session.date", { date: formatDate(t.locale, date) });
}

/**
 * The wall-clock time of a session timestamp as `HH:mm` — what the reading
 * page puts next to "started" and "ended". Undefined when the value has no
 * time part.
 */
export function sessionTimeLabel(value: string | undefined): string | undefined {
  if (value === undefined || !/[T ]\d/.test(value)) return undefined;
  const date = parseISO(value);
  return isValid(date) ? format(date, "HH:mm") : undefined;
}
