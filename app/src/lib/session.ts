// Session-file helpers for the live mode: the log-line parser, the elapsed
// timer and the epoch readings of `started`/`ended`. Pure functions —
// unit-tested, no react or query imports here.
//
// There is NO client-side date guessing left here (issue #40 and its
// review): WHICH file a session lives in is always the server's answer
// (GET /:campaign/session, with ?includeEnded=1 for the review — see
// lib/use-session.ts). A session past midnight lives in YESTERDAY's file,
// and a browser in another timezone than the server would get both the file
// and the runtime wrong.

import { isPaused, openPause, sessionPauses } from "@grimoire/shared/session-state";

export interface LogEntry {
  /** `HH:MM` — undefined for degraded raw lines. */
  time?: string;
  /** Scene id from the `(sceneId)` group; pauses and free notes have none. */
  sceneId?: string;
  text: string;
  /**
   * The line as it stands in the file (trimmed — the write API never emits
   * indented log lines). The review hashes THIS string for the session's
   * `reviewed` list, so it must travel alongside the parsed form.
   */
  raw: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `- HH:MM (sceneId) text` — the sceneId group is optional (pause lines …). */
const LOG_LINE = /^-\s+(\d{1,2}:\d{2})(?:\s+\(([^)]+)\))?\s+(.+)$/;

/**
 * The lines of the `## Log` section as entries, in file order. Degrade
 * rules: a line that does not match the log-line shape becomes a raw text
 * entry (no time, no sceneId), a missing Log section yields an empty list —
 * never an error.
 */
export function parseLogEntries(body: string): LogEntry[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s*Log\s*$/i.test(line.trim()));
  if (start === -1) return [];
  const entries: LogEntry[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    if (/^#{1,6}(\s|$)/.test(line)) break; // next section ends the log
    const m = LOG_LINE.exec(line);
    if (m !== null) {
      const entry: LogEntry = { time: m[1] ?? "", text: m[3] ?? "", raw: line };
      if (m[2] !== undefined) entry.sceneId = m[2];
      entries.push(entry);
    } else {
      entries.push({ text: line, raw: line });
    }
  }
  return entries;
}

/**
 * Parse `yyyy-mm-ddTHH:MM(:ss)?` as the BROWSER's local time — the fallback
 * reading of `started`/`ended` for a server that does not ship the epoch
 * values (see sessionStartMs). Undefined when the value does not parse.
 *
 * SECONDS are read when present — the `pauses` timestamps carry them (issue
 * #40 AK8), and dropping them made every pause up to a minute wrong.
 *
 * A DATE-ONLY `yyyy-mm-dd` is read as 00:00: a session started at exactly
 * midnight is written as `…T00:00`, and the YAML normalization cannot tell
 * that apart from a date-only value (shared/src/parse.ts) — so requiring a
 * time part made the timer disappear silently at midnight (issue #40).
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
 * Start / end of a session as epoch milliseconds (issue #40).
 *
 * The SERVER's reading wins (`startedMs`/`endedMs` of the FileResponse): the
 * file format is zone-less on purpose, and only the server knows the timezone
 * those wall-clock digits were written in — computing them in the browser
 * gave a runtime that was hours off whenever the two differ. The local parse
 * stays as the fallback for a response without the epoch fields.
 */
export function sessionStartMs(session: SessionTimes | undefined): number | undefined {
  if (session === undefined) return undefined;
  return session.startedMs ?? parseLocalDateTime(session.frontmatter?.started);
}

/** End of a session as epoch milliseconds — see sessionStartMs. */
export function sessionEndMs(session: SessionTimes | undefined): number | undefined {
  if (session === undefined) return undefined;
  return session.endedMs ?? parseLocalDateTime(session.frontmatter?.ended);
}

/** The bit of a session FileResponse the helpers here need. */
export interface SessionTimes {
  startedMs?: number;
  endedMs?: number;
  /** Sum of the CLOSED pause intervals (server arithmetic, issue #40 AK8). */
  pausedMs?: number;
  /** Start of the OPEN pause interval — present exactly while paused. */
  pausedSinceMs?: number;
  frontmatter?: Record<string, unknown>;
}

/**
 * Total paused time in milliseconds — the server's sum, with a local fallback
 * from the `pauses` frontmatter for a response that carries no `pausedMs`
 * (same fallback rule as sessionStartMs; degraded entries are dropped by the
 * shared `sessionPauses`).
 */
export function sessionPausedMs(session: SessionTimes | undefined): number {
  if (session === undefined) return 0;
  if (session.pausedMs !== undefined) return session.pausedMs;
  let sum = 0;
  for (const pause of sessionPauses(session.frontmatter)) {
    if (pause.to === undefined) continue;
    const from = parseLocalDateTime(pause.from);
    const to = parseLocalDateTime(pause.to);
    if (from === undefined || to === undefined) continue;
    sum += Math.max(0, to - from);
  }
  return sum;
}

/** Start of the running pause, or undefined when the session is not paused. */
export function sessionPausedSinceMs(session: SessionTimes | undefined): number | undefined {
  if (session === undefined) return undefined;
  if (session.pausedSinceMs !== undefined) return session.pausedSinceMs;
  const open = openPause(session.frontmatter);
  return open === undefined ? undefined : parseLocalDateTime(open.from);
}

/** True while the session is paused — the chip's dimmed state (AK8). */
export function sessionIsPaused(session: SessionTimes | undefined): boolean {
  return sessionPausedSinceMs(session) !== undefined || isPaused(session?.frontmatter);
}

/**
 * The session's RUNTIME in milliseconds (issue #40 AK8):
 *
 *     (ended ?? paused-since ?? now) − started − paused
 *
 * Pauses are deducted, and while one runs the clock STANDS: the reference
 * point is then the moment the pause began, so a re-render a minute later
 * shows the same number. `ended` and an open pause together (only reachable by
 * hand-editing) take the earlier of the two, so the value can never grow past
 * the end. Undefined when the file says nothing usable about `started`.
 */
export function sessionElapsedMs(
  session: SessionTimes | undefined,
  nowMs: number,
): number | undefined {
  const startedMs = sessionStartMs(session);
  if (startedMs === undefined) return undefined;
  const stops = [sessionEndMs(session), sessionPausedSinceMs(session)].filter(
    (v): v is number => v !== undefined,
  );
  const reference = stops.length === 0 ? nowMs : Math.min(...stops);
  return Math.max(0, reference - startedMs - sessionPausedMs(session));
}

/**
 * Elapsed time as `H:MM:SS`, clamped at `0:00:00`.
 *
 * The seconds are the point (PO feedback on issue #40): the session chip is
 * the only proof in the chrome that the evening is still running, and a
 * minutes-only readout that changed every ~15s looked frozen — the DM could
 * not tell a live clock from a stale render.
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
 * when there is no usable `started` (the chip then says "läuft").
 */
export function sessionElapsedLabel(
  session: SessionTimes | undefined,
  nowMs: number,
): string | undefined {
  const ms = sessionElapsedMs(session, nowMs);
  return ms === undefined ? undefined : formatDuration(ms);
}

/**
 * The session's HEADING — "Session vom 15.01.2026" (issue #58, PO decision).
 *
 * The session id used to be the label because it WAS the date; it is an opaque
 * random string now, so everything displayable about a session is derived from
 * `started`. Formatted from the wall-clock digits of the string itself, not via
 * `Date` and `toLocaleDateString`: the value is zone-less on purpose (README),
 * and re-reading it in the browser's timezone is how a session that started at
 * 23:30 ends up dated the next day.
 *
 * Falls back to a plain "Session" when there is no usable `started` — the
 * honest answer for a hand-edited file, and better than the raw id, which is
 * 36 characters of noise.
 */
export function sessionDateLabel(frontmatter: Record<string, unknown> | undefined): string {
  const started = frontmatter?.started;
  const m = typeof started === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(started.trim()) : null;
  if (m === null) return "Session";
  return `Session vom ${m[3]}.${m[2]}.${m[1]}`;
}
