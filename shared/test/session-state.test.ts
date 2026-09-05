// The ONE "is this session ended?" predicate (issue #40 review, finding 5).
// Server and app both import it, so this test pins the answers both sides
// depend on — above all the blank value, where they used to disagree: the
// client hid the live indicator while the server still counted the session as
// running and refused to end it.

import { describe, expect, test } from "bun:test";

import { isEnded, isEndedValue } from "../src/session-state";

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
