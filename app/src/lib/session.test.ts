import { describe, expect, test } from "bun:test";

import {
  formatElapsed,
  parseLocalDateTime,
  parseLogEntries,
  sessionEndMs,
  sessionStartMs,
} from "./session";

describe("parseLogEntries", () => {
  const body = `
## Log

- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision
- 20:30 — Pause
- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread

## Threads

- [ ] Wer bezahlt die Schmuggler?
`;

  test("parses lines with sceneId", () => {
    const entries = parseLogEntries(body);
    expect(entries[0]).toEqual({
      time: "19:52",
      sceneId: "lighthouse-arrival",
      text: "Spuren gefunden, Gruppe will sofort zur Bucht #decision",
      raw: "- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision",
    });
  });

  test("parses pause and free lines without sceneId", () => {
    const entries = parseLogEntries(body);
    expect(entries[1]).toEqual({ time: "20:30", text: "— Pause", raw: "- 20:30 — Pause" });
    expect(entries[2]).toEqual({
      time: "22:40",
      text: "— Cliffhanger: Lichter in der Bucht gesichtet #thread",
      raw: "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread",
    });
  });

  test("stops at the next section heading", () => {
    expect(parseLogEntries(body)).toHaveLength(3);
  });

  test("degrades garbage lines to raw text entries", () => {
    const entries = parseLogEntries("## Log\n\nkein Listenpunkt\n- ohne Zeitstempel\n");
    expect(entries).toEqual([
      { text: "kein Listenpunkt", raw: "kein Listenpunkt" },
      { text: "- ohne Zeitstempel", raw: "- ohne Zeitstempel" },
    ]);
  });

  test("missing Log section yields an empty list", () => {
    expect(parseLogEntries("## Notizen\n\n- 19:00 irgendwas\n")).toEqual([]);
    expect(parseLogEntries("")).toEqual([]);
  });

  test("fresh session file (heading only) yields an empty list", () => {
    expect(parseLogEntries("\n## Log\n")).toEqual([]);
  });
});

describe("parseLocalDateTime", () => {
  test("parses the write API's local datetime format", () => {
    expect(parseLocalDateTime("2026-01-15T19:30")).toBe(new Date(2026, 0, 15, 19, 30).getTime());
  });

  test("a date-only value is midnight (issue #40: the degraded `…T00:00`)", () => {
    expect(parseLocalDateTime("2026-01-15")).toBe(new Date(2026, 0, 15, 0, 0).getTime());
  });

  test("returns undefined for garbage and non-strings", () => {
    expect(parseLocalDateTime("gestern Abend")).toBeUndefined();
    expect(parseLocalDateTime(undefined)).toBeUndefined();
    expect(parseLocalDateTime(1234)).toBeUndefined();
  });
});

describe("sessionStartMs / sessionEndMs (issue #40)", () => {
  test("the SERVER's epoch reading wins over the local parse", () => {
    // A browser two hours off the server would compute 19:30 in ITS zone;
    // the server's value is the truth and must be used as it is.
    const serverMs = new Date(2026, 0, 15, 17, 30).getTime();
    const session = {
      startedMs: serverMs,
      endedMs: serverMs + 3 * 3_600_000,
      frontmatter: { started: "2026-01-15T19:30", ended: "2026-01-15T22:30" },
    };
    expect(sessionStartMs(session)).toBe(serverMs);
    expect(sessionEndMs(session)).toBe(serverMs + 3 * 3_600_000);
  });

  test("falls back to the local parse when the server sends no epoch fields", () => {
    const session = { frontmatter: { started: "2026-01-15T19:30" } };
    expect(sessionStartMs(session)).toBe(new Date(2026, 0, 15, 19, 30).getTime());
    expect(sessionEndMs(session)).toBeUndefined();
  });

  test("a midnight start still yields a time — the timer must not vanish", () => {
    // The frontmatter string degraded to a plain date (shared/src/parse.ts).
    expect(sessionStartMs({ frontmatter: { started: "2026-01-15" } })).toBe(
      new Date(2026, 0, 15, 0, 0).getTime(),
    );
  });

  test("no session, no frontmatter, no usable value -> undefined", () => {
    expect(sessionStartMs(undefined)).toBeUndefined();
    expect(sessionStartMs({})).toBeUndefined();
    expect(sessionStartMs({ frontmatter: {} })).toBeUndefined();
  });
});

describe("formatElapsed", () => {
  const start = new Date(2026, 0, 15, 19, 30).getTime();

  test("formats H:MM:SS", () => {
    expect(formatElapsed(start, start)).toBe("0:00:00");
    expect(formatElapsed(start, start + 5 * 60_000)).toBe("0:05:00");
    expect(formatElapsed(start, start + 95 * 60_000)).toBe("1:35:00");
    expect(formatElapsed(start, start + 10 * 60 * 60_000)).toBe("10:00:00");
  });

  test("clamps negative differences to 0:00:00", () => {
    expect(formatElapsed(start, start - 60_000)).toBe("0:00:00");
  });

  test("ticks in seconds", () => {
    expect(formatElapsed(start, start + 1_000)).toBe("0:00:01");
    expect(formatElapsed(start, start + 59_000)).toBe("0:00:59");
    expect(formatElapsed(start, start + 61_500)).toBe("0:01:01");
  });
});
