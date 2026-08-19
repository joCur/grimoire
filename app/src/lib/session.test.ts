import { describe, expect, test } from "bun:test";

import { formatElapsed, parseLocalDateTime, parseLogEntries, todaySessionRel } from "./session";

describe("todaySessionRel", () => {
  test("formats the LOCAL date with zero padding", () => {
    expect(todaySessionRel(new Date(2026, 0, 5, 23, 59))).toBe("sessions/2026-01-05.md");
    expect(todaySessionRel(new Date(2026, 11, 31, 0, 0))).toBe("sessions/2026-12-31.md");
  });
});

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
    });
  });

  test("parses pause and free lines without sceneId", () => {
    const entries = parseLogEntries(body);
    expect(entries[1]).toEqual({ time: "20:30", text: "— Pause" });
    expect(entries[2]).toEqual({
      time: "22:40",
      text: "— Cliffhanger: Lichter in der Bucht gesichtet #thread",
    });
  });

  test("stops at the next section heading", () => {
    expect(parseLogEntries(body)).toHaveLength(3);
  });

  test("degrades garbage lines to raw text entries", () => {
    const entries = parseLogEntries("## Log\n\nkein Listenpunkt\n- ohne Zeitstempel\n");
    expect(entries).toEqual([{ text: "kein Listenpunkt" }, { text: "- ohne Zeitstempel" }]);
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

  test("returns undefined for garbage and non-strings", () => {
    expect(parseLocalDateTime("gestern Abend")).toBeUndefined();
    expect(parseLocalDateTime(undefined)).toBeUndefined();
    expect(parseLocalDateTime(1234)).toBeUndefined();
  });
});

describe("formatElapsed", () => {
  const start = new Date(2026, 0, 15, 19, 30).getTime();

  test("formats H:MM", () => {
    expect(formatElapsed(start, start)).toBe("0:00");
    expect(formatElapsed(start, start + 5 * 60_000)).toBe("0:05");
    expect(formatElapsed(start, start + 95 * 60_000)).toBe("1:35");
    expect(formatElapsed(start, start + 10 * 60 * 60_000)).toBe("10:00");
  });

  test("clamps negative differences to 0:00", () => {
    expect(formatElapsed(start, start - 60_000)).toBe("0:00");
  });

  test("floors partial minutes", () => {
    expect(formatElapsed(start, start + 59_000)).toBe("0:00");
  });
});
