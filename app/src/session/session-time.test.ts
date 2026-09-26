import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";

import {
  formatDuration,
  openPause,
  sessionDateLabel,
  sessionElapsedLabel,
  sessionElapsedMs,
  sessionIsPaused,
  sessionPausedMs,
  sessionPausedSinceMs,
  sessionTimeLabel,
} from "./session-time";

// The language the assertions below are written in: the helpers take the
// translator as an argument, so a test says so explicitly instead of leaning
// on a default.
const t = translator("de");

// A pause as the session endpoints send it: the wall-clock strings plus the
// server's epoch reading of them.
function pause(fromMs: number, toMs?: number) {
  return {
    from: new Date(fromMs).toISOString(),
    fromMs,
    ...(toMs === undefined ? {} : { to: new Date(toMs).toISOString(), toMs }),
  };
}

describe("formatDuration", () => {
  test("formats H:MM:SS", () => {
    expect(formatDuration(0)).toBe("0:00:00");
    expect(formatDuration(5 * 60_000)).toBe("0:05:00");
    expect(formatDuration(95 * 60_000)).toBe("1:35:00");
    expect(formatDuration(10 * 60 * 60_000)).toBe("10:00:00");
  });

  test("clamps negative differences to 0:00:00", () => {
    expect(formatDuration(-60_000)).toBe("0:00:00");
  });

  test("ticks in seconds", () => {
    expect(formatDuration(1_000)).toBe("0:00:01");
    expect(formatDuration(59_000)).toBe("0:00:59");
    expect(formatDuration(61_500)).toBe("0:01:01");
  });
});

// The runtime with pauses deducted. Every epoch value comes from the server
// and is used as it is — the app never re-reads a zone-less string for it.
describe("sessionElapsedMs (pauses deducted)", () => {
  const started = new Date(2026, 0, 15, 19, 0).getTime();
  const now = started + 60 * 60_000; // 20:00

  test("no pause: (now − started)", () => {
    expect(sessionElapsedMs({ startedMs: started }, now)).toBe(60 * 60_000);
    expect(sessionElapsedLabel({ startedMs: started }, now)).toBe("1:00:00");
  });

  test("ONE closed pause is subtracted", () => {
    const session = {
      startedMs: started,
      pauses: [pause(started + 10 * 60_000, started + 20 * 60_000)],
    };
    expect(sessionElapsedMs(session, now)).toBe(50 * 60_000);
    expect(sessionElapsedLabel(session, now)).toBe("0:50:00");
    expect(sessionIsPaused(session)).toBe(false);
  });

  test("SEVERAL pauses: every closed interval is subtracted", () => {
    const session = {
      startedMs: started,
      pauses: [
        pause(started + 10 * 60_000, started + 20 * 60_000),
        pause(started + 30 * 60_000, started + 35 * 60_000),
        pause(started + 40 * 60_000, started + 40 * 60_000 + 30_000),
      ],
    };
    expect(sessionElapsedLabel(session, now)).toBe("0:44:30");
  });

  test("while a pause runs the clock STANDS", () => {
    const session = {
      startedMs: started,
      pauses: [
        pause(started + 10 * 60_000, started + 20 * 60_000),
        pause(started + 45 * 60_000), // paused at 19:45, still open
      ],
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
      pauses: [pause(started + 10 * 60_000, started + 30 * 60_000)],
    };
    expect(sessionElapsedLabel(session, now + 10 * 60 * 60_000)).toBe("2:40:00");
  });

  test("`ended` plus an open pause: the EARLIER one wins", () => {
    const session = {
      startedMs: started,
      endedMs: started + 3 * 60 * 60_000,
      pauses: [pause(started + 60 * 60_000)],
    };
    expect(sessionElapsedLabel(session, now)).toBe("1:00:00");
  });

  test("no session -> no runtime at all", () => {
    expect(sessionElapsedMs(undefined, now)).toBeUndefined();
    expect(sessionElapsedLabel(undefined, now)).toBeUndefined();
  });

  test("never negative: a `started` in the future clamps at 0:00:00", () => {
    expect(sessionElapsedLabel({ startedMs: now + 60_000 }, now)).toBe("0:00:00");
    // …and so does a pause sum larger than the wall-clock span.
    expect(
      sessionElapsedLabel(
        { startedMs: started, pauses: [pause(started, started + 99 * 60 * 60_000)] },
        now,
      ),
    ).toBe("0:00:00");
  });
});

describe("sessionPausedMs / sessionPausedSinceMs", () => {
  const started = new Date(2026, 0, 15, 19, 0).getTime();

  test("sums the CLOSED intervals only", () => {
    const session = {
      startedMs: started,
      pauses: [
        pause(started + 10 * 60_000, started + 20 * 60_000),
        pause(started + 40 * 60_000),
      ],
    };
    expect(sessionPausedMs(session)).toBe(10 * 60_000);
    expect(sessionPausedSinceMs(session)).toBe(started + 40 * 60_000);
    expect(sessionIsPaused(session)).toBe(true);
  });

  test("the LAST open interval is the running pause", () => {
    const session = {
      startedMs: started,
      pauses: [pause(started + 10 * 60_000), pause(started + 40 * 60_000)],
    };
    expect(sessionPausedSinceMs(session)).toBe(started + 40 * 60_000);
  });

  test("no pauses at all -> 0 and not paused", () => {
    expect(sessionPausedMs(undefined)).toBe(0);
    expect(sessionPausedMs({ startedMs: started })).toBe(0);
    expect(sessionIsPaused({ startedMs: started })).toBe(false);
    expect(sessionPausedSinceMs({ startedMs: started })).toBeUndefined();
  });
});

describe("openPause", () => {
  const row = (id: string, to?: string) => ({
    id,
    from: "2026-01-15T19:10:00",
    ...(to === undefined ? {} : { to }),
    rev: 1,
  });

  test("the LAST pause without an end is the running one", () => {
    const pauses = [row("a"), row("b", "2026-01-15T19:20:00"), row("c")];
    expect(openPause({ pauses })?.id).toBe("c");
  });

  test("every pause ended, or none at all: nothing runs", () => {
    expect(openPause({ pauses: [row("a", "2026-01-15T19:20:00")] })).toBeUndefined();
    expect(openPause({ pauses: [] })).toBeUndefined();
  });
});

describe("sessionDateLabel", () => {
  test("the heading of a session is its `started` date, German format", () => {
    expect(sessionDateLabel({ started: "2026-01-15T19:30:00" }, t)).toBe("Session vom 15.01.2026");
    // Minute-precise and date-only (the midnight degradation) read the same —
    // only the date part is used.
    expect(sessionDateLabel({ started: "2026-01-15T19:30" }, t)).toBe("Session vom 15.01.2026");
    expect(sessionDateLabel({ started: "2026-01-15" }, t)).toBe("Session vom 15.01.2026");
  });

  test("a session close to midnight keeps ITS day (no timezone re-reading)", () => {
    expect(sessionDateLabel({ started: "2026-01-15T23:59:59" }, t)).toBe("Session vom 15.01.2026");
  });

  test("the opaque id is never the label — no `started`, no date", () => {
    expect(sessionDateLabel({}, t)).toBe("Session");
    expect(sessionDateLabel({ started: "gestern abend" }, t)).toBe("Session");
    expect(sessionDateLabel(undefined, t)).toBe("Session");
  });
});

describe("sessionTimeLabel", () => {
  test("the wall-clock time of a timestamp, zero-padded", () => {
    expect(sessionTimeLabel("2026-01-15T19:30:00")).toBe("19:30");
    expect(sessionTimeLabel("2026-01-15T09:05")).toBe("09:05");
  });

  test("no time part, no label", () => {
    expect(sessionTimeLabel("2026-01-15")).toBeUndefined();
    expect(sessionTimeLabel(undefined)).toBeUndefined();
  });
});
