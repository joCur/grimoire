// The pure half of the session hooks: how a `POST /session/start` 409 is
// read (issue #40 review, finding 2). Everything else in use-session.ts is
// react-query wiring and is covered by the E2E session cycle.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { conflictPath, noSessionYet, sessionStartConflict } from "./use-session";

const conflict = (details: Record<string, unknown>) =>
  new ApiError(409, "conflict", { error: "…", ...details });

describe("sessionStartConflict", () => {
  test("recognizes the two documented codes", () => {
    expect(sessionStartConflict(conflict({ code: "session_ended" }))).toBe("session_ended");
    expect(sessionStartConflict(conflict({ code: "session_running" }))).toBe("session_running");
  });

  test("anything else is a plain error, not a question", () => {
    expect(sessionStartConflict(conflict({}))).toBeUndefined();
    expect(sessionStartConflict(conflict({ code: "whatever" }))).toBeUndefined();
    expect(sessionStartConflict(new ApiError(500, "boom"))).toBeUndefined();
    expect(sessionStartConflict(new Error("network"))).toBeUndefined();
    expect(sessionStartConflict(null)).toBeUndefined();
  });
});

describe("conflictPath", () => {
  test("returns the session the conflict points at, or undefined", () => {
    expect(conflictPath(conflict({ path: "sessions/2026-08-18.md" }))).toBe(
      "sessions/2026-08-18.md",
    );
    expect(conflictPath(conflict({ path: 42 }))).toBeUndefined();
    expect(conflictPath(new Error("nope"))).toBeUndefined();
  });
});

describe("noSessionYet", () => {
  test("only a 404 means 'there is none'", () => {
    expect(noSessionYet(new ApiError(404, "no active session"))).toBe(true);
    expect(noSessionYet(new ApiError(500, "boom"))).toBe(false);
    expect(noSessionYet(new Error("offline"))).toBe(false);
  });
});
