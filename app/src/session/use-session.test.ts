// The pure half of the session hooks: how a start's 409 (`POST …/sessions`)
// is read. Everything else in use-session.ts is react-query wiring and is
// covered by the E2E session cycle.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { conflictSessionId, sessionStartConflict } from "./use-session";

const conflict = (details: Record<string, unknown>) =>
  new ApiError(409, "conflict", { error: "…", ...details });

describe("sessionStartConflict", () => {
  test("recognizes the one documented code", () => {
    expect(sessionStartConflict(conflict({ code: "session_running" }))).toBe("session_running");
  });

  test("anything else is a plain error, not a question", () => {
    // `session_ended` refuses a write INTO an ended session; a start never
    // answers it, and it must not become a question about the start.
    expect(sessionStartConflict(conflict({ code: "session_ended" }))).toBeUndefined();
    expect(sessionStartConflict(conflict({}))).toBeUndefined();
    expect(sessionStartConflict(conflict({ code: "whatever" }))).toBeUndefined();
    expect(sessionStartConflict(new ApiError(500, "boom"))).toBeUndefined();
    expect(sessionStartConflict(new Error("network"))).toBeUndefined();
    expect(sessionStartConflict(null)).toBeUndefined();
  });
});

describe("conflictSessionId", () => {
  test("returns the session the conflict points at, or undefined", () => {
    expect(conflictSessionId(conflict({ id: "s-7" }))).toBe("s-7");
    // Only `id` names a session; a stray `sessionId` is not a second name.
    expect(conflictSessionId(conflict({ sessionId: "s-42" }))).toBeUndefined();
    expect(conflictSessionId(conflict({ id: 42 }))).toBeUndefined();
    expect(conflictSessionId(conflict({}))).toBeUndefined();
    expect(conflictSessionId(new Error("nope"))).toBeUndefined();
  });
});
