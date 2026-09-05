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
 * A DATE-ONLY `yyyy-mm-dd` is read as 00:00: a session started at exactly
 * midnight is written as `…T00:00`, and the YAML normalization cannot tell
 * that apart from a date-only value (shared/src/parse.ts) — so requiring a
 * time part made the timer disappear silently at midnight (issue #40).
 */
export function parseLocalDateTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(value.trim());
  if (m === null) return undefined;
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
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

/** The bit of a session FileResponse the two helpers above need. */
export interface SessionTimes {
  startedMs?: number;
  endedMs?: number;
  frontmatter?: Record<string, unknown>;
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
  const secs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  return `${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
}
