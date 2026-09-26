// How a child's answer lands in its session: the folds are pure, and the
// cache updates fold into every cached copy of the session they name.

import { describe, expect, test } from "bun:test";
import type { Session } from "@grimoire/shared/session";
import { QueryClient } from "@tanstack/react-query";

import {
  putSession,
  runningSessionKey,
  sessionKey,
  sessionsKey,
  updateSession,
  withLogEntry,
  withPause,
  withPlayedScene,
} from "./session-query";

const session = (id: string, extra: Partial<Session> = {}): Session => ({
  id,
  started: "2026-01-15T19:00:00",
  body: "",
  pauses: [],
  log: [],
  playedScenes: [],
  rev: 1,
  ...extra,
});

const entry = { id: "l1", at: "19:30", sceneId: "harbor", text: "Notiz", reviewed: false, rev: 1 };

describe("the folds", () => {
  test("a new row is appended, a known one replaced in its place", () => {
    const one = withLogEntry(session("s"), entry);
    expect(one.log).toEqual([entry]);
    const reviewed = { ...entry, reviewed: true, rev: 2 };
    expect(withLogEntry(one, reviewed).log).toEqual([reviewed]);
  });

  test("pauses and played scenes fold the same way", () => {
    const pause = { id: "p1", from: "2026-01-15T19:10:00", rev: 1 };
    const ended = { ...pause, to: "2026-01-15T19:20:00", rev: 2 };
    expect(withPause(withPause(session("s"), pause), ended).pauses).toEqual([ended]);
    const played = { id: "x", sceneId: "harbor", rev: 1 };
    expect(withPlayedScene(session("s"), played).playedScenes).toEqual([played]);
  });
});

describe("updateSession", () => {
  test("folds into the session, the running one and the list — only where it is that session", () => {
    const client = new QueryClient();
    client.setQueryData(sessionKey("c", "s"), session("s"));
    client.setQueryData(runningSessionKey("c"), session("s"));
    client.setQueryData(sessionsKey("c"), [session("s"), session("older")]);
    updateSession(client, "c", "s", (current) => withLogEntry(current, entry));
    expect(client.getQueryData<Session>(sessionKey("c", "s"))?.log).toEqual([entry]);
    expect(client.getQueryData<Session>(runningSessionKey("c"))?.log).toEqual([entry]);
    const list = client.getQueryData<Session[]>(sessionsKey("c"));
    expect(list?.[0]?.log).toEqual([entry]);
    expect(list?.[1]?.log).toEqual([]);
  });

  test("a running session of another id stays as it is", () => {
    const client = new QueryClient();
    client.setQueryData(runningSessionKey("c"), session("other"));
    updateSession(client, "c", "s", (current) => withLogEntry(current, entry));
    expect(client.getQueryData<Session>(runningSessionKey("c"))?.log).toEqual([]);
  });
});

describe("putSession", () => {
  test("an ended session is no longer the running one, and keeps its place in the list", () => {
    const client = new QueryClient();
    client.setQueryData(runningSessionKey("c"), session("s"));
    client.setQueryData(sessionsKey("c"), [session("s")]);
    const ended = session("s", { ended: "2026-01-15T23:00:00", rev: 2 });
    putSession(client, "c", ended);
    expect(client.getQueryData(runningSessionKey("c"))).toBeNull();
    expect(client.getQueryData<Session[]>(sessionsKey("c"))).toEqual([ended]);
    expect(client.getQueryData<Session>(sessionKey("c", "s"))).toEqual(ended);
  });

  test("a started session is the running one", () => {
    const client = new QueryClient();
    client.setQueryData(runningSessionKey("c"), null);
    putSession(client, "c", session("new"));
    expect(client.getQueryData<Session>(runningSessionKey("c"))?.id).toBe("new");
  });
});
