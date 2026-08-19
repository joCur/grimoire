// Session-file helpers for the live mode: today's path (matching the
// server's LOCAL-date convention, server/src/clock.ts), the log-line parser
// and the elapsed-timer format. Pure functions — unit-tested, no react or
// query imports here.

export interface LogEntry {
  /** `HH:MM` — undefined for degraded raw lines. */
  time?: string;
  /** Scene id from the `(sceneId)` group; pauses and free notes have none. */
  sceneId?: string;
  text: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `sessions/<yyyy-mm-dd>.md` for the LOCAL date — mirrors the server clock. */
export function todaySessionRel(d: Date = new Date()): string {
  return `sessions/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
}

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
      const entry: LogEntry = { time: m[1] ?? "", text: m[3] ?? "" };
      if (m[2] !== undefined) entry.sceneId = m[2];
      entries.push(entry);
    } else {
      entries.push({ text: line });
    }
  }
  return entries;
}

/**
 * Parse `yyyy-mm-ddTHH:MM(:ss)?` as LOCAL time — the format the write API
 * produces for `started`/`ended`. Undefined when the value does not parse.
 */
export function parseLocalDateTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(value.trim());
  if (m === null) return undefined;
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/** Elapsed time as `H:MM` (prototype format), clamped at `0:00`. */
export function formatElapsed(startMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - startMs) / 60000));
  return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
}
