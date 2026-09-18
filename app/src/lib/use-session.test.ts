// The pure half of the session hooks: how a `POST /session/start` 409 is
// read. Everything else in use-session.ts is react-query wiring and is
// covered by the E2E session cycle.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { conflictSessionId, noSessionYet, sessionStartConflict } from "./use-session";

const conflict = (details: Record<string, unknown>) =>
  new ApiError(409, "conflict", { error: "…", ...details });

describe("sessionStartConflict", () => {
  test("recognizes the one documented code", () => {
    expect(sessionStartConflict(conflict({ code: "session_running" }))).toBe("session_running");
  });

  test("anything else is a plain error, not a question", () => {
    // `session_ended` is gone with the resume semantics: a start after an
    // ended session creates a new one, so this code never arrives — and if an
    // older server sent it, it must not become a resume offer.
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
    expect(conflictSessionId(conflict({ sessionId: "s-42" }))).toBe("s-42");
    // `id` is read as well — the same answer under the plainer name.
    expect(conflictSessionId(conflict({ id: "s-7" }))).toBe("s-7");
    expect(conflictSessionId(conflict({ sessionId: 42 }))).toBeUndefined();
    expect(conflictSessionId(conflict({}))).toBeUndefined();
    expect(conflictSessionId(new Error("nope"))).toBeUndefined();
  });
});

describe("noSessionYet", () => {
  test("only a 404 means 'there is none'", () => {
    expect(noSessionYet(new ApiError(404, "no active session"))).toBe(true);
    expect(noSessionYet(new ApiError(500, "boom"))).toBe(false);
    expect(noSessionYet(new Error("offline"))).toBe(false);
  });
});
