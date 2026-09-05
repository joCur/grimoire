// The ONE "is this session ended?" predicate (issue #40 review, finding 5).
// Server and app both import it, so this test pins the answers both sides
// depend on — above all the blank value, where they used to disagree: the
// client hid the live indicator while the server still counted the session as
// running and refused to end it.

import { describe, expect, test } from "bun:test";

import {
  isEnded,
  isEndedValue,
  isPaused,
  isSessionEmpty,
  openPause,
  sessionPauses,
} from "../src/session-state";

describe("isEndedValue", () => {
  test("a real timestamp ends the session", () => {
    expect(isEndedValue("2026-08-19T23:45")).toBe(true);
    expect(isEndedValue("2026-08-19")).toBe(true);
    // A YAML date object (the parser normalizes it, but never trust that here)
    expect(isEndedValue(new Date())).toBe(true);
  });

  test("missing, null, empty and blank all mean RUNNING", () => {
    expect(isEndedValue(undefined)).toBe(false);
    expect(isEndedValue(null)).toBe(false);
    expect(isEndedValue("")).toBe(false);
    expect(isEndedValue("   ")).toBe(false);
  });
});

describe("isEnded", () => {
  test("reads the `ended` key of a session frontmatter", () => {
    expect(isEnded({ started: "2026-08-19T21:05" })).toBe(false);
    expect(isEnded({ ended: "" })).toBe(false);
    expect(isEnded({ ended: "2026-08-19T23:45" })).toBe(true);
    expect(isEnded(undefined)).toBe(false);
  });
});

// The predicate behind "Session verwerfen" (issue #40 AK7): the app offers
// the action for it, the server enforces it before deleting the file — so
// both sides must answer identically or the button leads into a 409.
describe("isSessionEmpty", () => {
  const FRESH = "\n## Log\n"; // exactly what startSession writes

  test("the freshly started session is empty", () => {
    expect(isSessionEmpty({ started: "2026-08-19T21:05", scenes_played: [] }, FRESH)).toBe(true);
    // …with no `scenes_played` key at all, and with a Log-less body.
    expect(isSessionEmpty({ started: "2026-08-19T21:05" }, FRESH)).toBe(true);
    expect(isSessionEmpty({}, "")).toBe(true);
    expect(isSessionEmpty(undefined, "\n\n## Log\n\n## Threads\n")).toBe(true);
  });

  test("one log entry is content", () => {
    expect(isSessionEmpty({ scenes_played: [] }, "\n## Log\n\n- 21:30 Ankunft\n")).toBe(false);
    // …and so is anything else hand-typed into the body.
    expect(isSessionEmpty({ scenes_played: [] }, "\n## Log\n\nfreier Text\n")).toBe(false);
  });

  test("a played scene is content even with an empty log", () => {
    expect(isSessionEmpty({ scenes_played: ["lighthouse-arrival"] }, FRESH)).toBe(false);
    // Degraded shape: a scalar instead of a list still counts as played.
    expect(isSessionEmpty({ scenes_played: "lighthouse-arrival" }, FRESH)).toBe(false);
    expect(isSessionEmpty({ scenes_played: null }, FRESH)).toBe(true);
  });
});

// The `pauses` field (issue #40 AK8): hand-editable, so every reader goes
// through these degrade rules instead of trusting the shape.
describe("sessionPauses / openPause / isPaused", () => {
  test("reads the intervals in file order, open interval last", () => {
    const fm = {
      pauses: [
        { from: "2026-08-19T21:10:00", to: "2026-08-19T21:20:30" },
        { from: "2026-08-19T22:00:00" },
      ],
    };
    expect(sessionPauses(fm)).toEqual([
      { from: "2026-08-19T21:10:00", to: "2026-08-19T21:20:30" },
      { from: "2026-08-19T22:00:00" },
    ]);
    expect(openPause(fm)).toEqual({ from: "2026-08-19T22:00:00" });
    expect(isPaused(fm)).toBe(true);
  });

  test("no key, null, or a closed list -> not paused", () => {
    expect(sessionPauses(undefined)).toEqual([]);
    expect(sessionPauses({})).toEqual([]);
    expect(sessionPauses({ pauses: null })).toEqual([]);
    expect(isPaused({ pauses: [{ from: "2026-08-19T21:10", to: "2026-08-19T21:20" }] })).toBe(false);
  });

  test("a single mapping instead of a list is read as one entry", () => {
    expect(sessionPauses({ pauses: { from: "2026-08-19T21:10" } })).toEqual([
      { from: "2026-08-19T21:10" },
    ]);
  });

  test("broken entries are DROPPED, never fatal", () => {
    const fm = {
      pauses: [
        "kaputt", // not a mapping
        42,
        null,
        ["nested"],
        { to: "2026-08-19T21:10" }, // no from
        { from: "gestern abend" }, // unreadable from
        { from: 12345 }, // not a string
        // An unreadable `to` drops the entry too: reading it as OPEN would
        // stop the session clock forever on a typo.
        { from: "2026-08-19T21:20", to: "irgendwann" },
        { from: " 2026-08-19T21:30 ", to: "2026-08-19T21:33" }, // trimmed
      ],
    };
    expect(sessionPauses(fm)).toEqual([{ from: "2026-08-19T21:30", to: "2026-08-19T21:33" }]);
    expect(openPause(fm)).toBeUndefined();
    expect(isPaused(fm)).toBe(false);
  });

  test("a date-only value is a usable timestamp (midnight, like started)", () => {
    expect(sessionPauses({ pauses: [{ from: "2026-08-19" }] })).toEqual([{ from: "2026-08-19" }]);
  });
});
