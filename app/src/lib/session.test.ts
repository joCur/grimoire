import { describe, expect, test } from "bun:test";

import {
  formatElapsed,
  parseLocalDateTime,
  parseLogEntries,
  sessionElapsedLabel,
  sessionElapsedMs,
  sessionEndMs,
  sessionIsPaused,
  sessionPausedMs,
  sessionDateLabel,
  sessionPausedSinceMs,
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

// The runtime with pauses deducted (issue #40 AK8). Every epoch value the
// server ships is used as-is; the frontmatter fallback is only for a response
// without them.
describe("sessionElapsedMs (pauses deducted)", () => {
  const started = new Date(2026, 0, 15, 19, 0).getTime();
  const now = started + 60 * 60_000; // 20:00

  test("no pause: (now − started)", () => {
    expect(sessionElapsedMs({ startedMs: started }, now)).toBe(60 * 60_000);
    expect(sessionElapsedLabel({ startedMs: started }, now)).toBe("1:00:00");
  });

  test("ONE closed pause is subtracted", () => {
    const session = { startedMs: started, pausedMs: 10 * 60_000 };
    expect(sessionElapsedMs(session, now)).toBe(50 * 60_000);
    expect(sessionElapsedLabel(session, now)).toBe("0:50:00");
    expect(sessionIsPaused(session)).toBe(false);
  });

  test("SEVERAL pauses: the server's sum is subtracted once", () => {
    const session = { startedMs: started, pausedMs: 10 * 60_000 + 5 * 60_000 + 30_000 };
    expect(sessionElapsedLabel(session, now)).toBe("0:44:30");
  });

  test("while a pause runs the clock STANDS", () => {
    const session = {
      startedMs: started,
      pausedMs: 10 * 60_000,
      pausedSinceMs: started + 45 * 60_000, // paused at 19:45
    };
    expect(sessionIsPaused(session)).toBe(true);
    // 45 min wall clock − 10 min earlier pause, and it stays there …
    expect(sessionElapsedLabel(session, now)).toBe("0:35:00");
    expect(sessionElapsedLabel(session, now + 10 * 60_000)).toBe("0:35:00");
  });

  test("an ENDED session freezes at `ended`, pauses still deducted", () => {
    const session = {
      startedMs: started,
      endedMs: started + 3 * 60 * 60_000,
      pausedMs: 20 * 60_000,
    };
    expect(sessionElapsedLabel(session, now + 10 * 60 * 60_000)).toBe("2:40:00");
  });

  test("`ended` plus an open pause (hand-edited): the EARLIER one wins", () => {
    const session = {
      startedMs: started,
      endedMs: started + 3 * 60 * 60_000,
      pausedSinceMs: started + 60 * 60_000,
    };
    expect(sessionElapsedLabel(session, now)).toBe("1:00:00");
  });

  test("no usable `started` -> no runtime at all", () => {
    expect(sessionElapsedMs(undefined, now)).toBeUndefined();
    expect(sessionElapsedMs({ frontmatter: {} }, now)).toBeUndefined();
    expect(sessionElapsedLabel({}, now)).toBeUndefined();
  });

  test("never negative: a `started` in the future clamps at 0:00:00", () => {
    expect(sessionElapsedLabel({ startedMs: now + 60_000 }, now)).toBe("0:00:00");
    // …and so does a pause sum larger than the wall-clock span.
    expect(sessionElapsedLabel({ startedMs: started, pausedMs: 99 * 60 * 60_000 }, now)).toBe(
      "0:00:00",
    );
  });
});

describe("sessionPausedMs / sessionPausedSinceMs — the frontmatter fallback", () => {
  test("sums the closed intervals of `pauses` when the server sent no epochs", () => {
    const session = {
      frontmatter: {
        started: "2026-01-15T19:00",
        pauses: [
          { from: "2026-01-15T19:10:00", to: "2026-01-15T19:20:30" },
          { from: "2026-01-15T19:40:00", to: "2026-01-15T19:45:00" },
        ],
      },
    };
    expect(sessionPausedMs(session)).toBe(10 * 60_000 + 30_000 + 5 * 60_000);
    expect(sessionPausedSinceMs(session)).toBeUndefined();
    expect(sessionElapsedLabel(session, new Date(2026, 0, 15, 20, 0).getTime())).toBe("0:44:30");
  });

  test("an open interval freezes the clock; degraded entries are ignored", () => {
    const session = {
      frontmatter: {
        started: "2026-01-15T19:00",
        pauses: ["kaputt", { from: "gestern" }, { from: "2026-01-15T19:30:00" }],
      },
    };
    expect(sessionPausedMs(session)).toBe(0);
    expect(sessionPausedSinceMs(session)).toBe(new Date(2026, 0, 15, 19, 30).getTime());
    expect(sessionIsPaused(session)).toBe(true);
    expect(sessionElapsedLabel(session, new Date(2026, 0, 15, 21, 0).getTime())).toBe("0:30:00");
  });

  test("the SERVER's values win over the frontmatter", () => {
    const session = {
      startedMs: new Date(2026, 0, 15, 19, 0).getTime(),
      pausedMs: 60_000,
      frontmatter: {
        started: "2026-01-15T19:00",
        pauses: [{ from: "2026-01-15T19:10", to: "2026-01-15T19:50" }],
      },
    };
    expect(sessionPausedMs(session)).toBe(60_000);
  });

  test("no pauses at all -> 0 and not paused", () => {
    expect(sessionPausedMs(undefined)).toBe(0);
    expect(sessionPausedMs({ frontmatter: {} })).toBe(0);
    expect(sessionIsPaused({ frontmatter: {} })).toBe(false);
    expect(sessionPausedSinceMs({})).toBeUndefined();
  });
});

describe("sessionDateLabel", () => {
  test("the heading of a session is its `started` date, German format", () => {
    expect(sessionDateLabel({ started: "2026-01-15T19:30:00" })).toBe("Session vom 15.01.2026");
    // Minute-precise (pre-#58 files) and date-only (the midnight degradation)
    // read the same — only the date part is used.
    expect(sessionDateLabel({ started: "2026-01-15T19:30" })).toBe("Session vom 15.01.2026");
    expect(sessionDateLabel({ started: "2026-01-15" })).toBe("Session vom 15.01.2026");
  });

  test("a session close to midnight keeps ITS day (no timezone re-reading)", () => {
    expect(sessionDateLabel({ started: "2026-01-15T23:59:59" })).toBe("Session vom 15.01.2026");
  });

  test("the opaque id is never the label — no `started`, no date", () => {
    const id = "019a4f3c-6d21-7b8e-9c04-5f1ab2d7e380";
    expect(sessionDateLabel({ id })).toBe("Session");
    expect(sessionDateLabel({ id, started: "gestern abend" })).toBe("Session");
    expect(sessionDateLabel({ started: 20260115 })).toBe("Session");
    expect(sessionDateLabel(undefined)).toBe("Session");
  });
});
