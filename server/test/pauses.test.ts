// The pause resource: begun with POST, ended and corrected with PATCH, each
// pause with its own id and rev under its session.
//
// A pause is an interval of the session's clock and nothing else: it writes
// no log entry, and no pause write moves the session's `rev`. Its ends carry
// the server's epoch reading beside the zone-less strings, so the client only
// ever subtracts numbers. Every case runs against its own in-memory database
// seeded from the committed fixtures, with the system clock faked.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { Pause } from "@grimoire/shared/pause";
import type { Session } from "@grimoire/shared/session";
import { dropStore, seedStore } from "./support/store";
import {
  FIXTURE_SESSION,
  SESSIONS,
  endSession,
  readSession,
  send,
  startSession,
} from "./support/sessions";

let session: Session;

function pausesUrl(sessionId = session.id): string {
  return `${SESSIONS}/${sessionId}/pauses`;
}

/** Begin a pause at `at`; it has to be a new one. */
async function beginPause(at: Date): Promise<Pause> {
  setSystemTime(at);
  const res = await send("POST", pausesUrl());
  expect(res.status).toBe(201);
  return (await res.json()) as Pause;
}

/** End a pause at `at`, against its `rev`. */
async function endPause(pause: Pause, at: Date): Promise<Pause> {
  const res = await send("PATCH", `${pausesUrl()}/${pause.id}`, {
    rev: pause.rev,
    toMs: at.getTime(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Pause;
}

beforeEach(async () => {
  setSystemTime(new Date(2026, 7, 19, 21, 0));
  await seedStore();
  session = await startSession();
});

afterEach(() => {
  dropStore();
  setSystemTime();
});

describe("beginning a pause — POST …/sessions/:id/pauses", () => {
  test("opens an interval on the server's clock, with its reading, 201", async () => {
    const pause = await beginPause(new Date(2026, 7, 19, 21, 40, 12));
    expect(pause).toEqual({
      id: expect.any(String),
      from: "2026-08-19T21:40:12",
      fromMs: new Date(2026, 7, 19, 21, 40, 12).getTime(),
      rev: 1,
    });
    const read = await readSession(session.id);
    expect(read.pauses).toEqual([pause]);
    // A pause is no log entry, and the session's own guard stands.
    expect(read.log).toEqual([]);
    expect(read.rev).toBe(session.rev);
  });

  test("while one is open, the same pause comes back with 200 — never a second", async () => {
    const pause = await beginPause(new Date(2026, 7, 19, 21, 30));
    setSystemTime(new Date(2026, 7, 19, 21, 31));
    const again = await send("POST", pausesUrl());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(pause);
    expect((await readSession(session.id)).pauses).toHaveLength(1);
  });

  test("a pause after a closed one is appended", async () => {
    const first = await beginPause(new Date(2026, 7, 19, 21, 10));
    await endPause(first, new Date(2026, 7, 19, 21, 20));
    const second = await beginPause(new Date(2026, 7, 19, 22, 0));
    expect((await readSession(session.id)).pauses.map((p) => p.id)).toEqual([first.id, second.id]);
  });

  test("409 session_ended on an ended session, 404 on an unknown one", async () => {
    await endSession(session.id);
    const ended = await send("POST", pausesUrl());
    expect(ended.status).toBe(409);
    expect(await ended.json()).toEqual({
      error: expect.any(String),
      code: "session_ended",
      id: session.id,
    });
    expect((await readSession(session.id)).pauses).toEqual([]);
    expect((await send("POST", pausesUrl("gibt-es-nicht"))).status).toBe(404);
  });

  test("400 for a key in the body — a pause begins on the server's clock", async () => {
    expect((await send("POST", pausesUrl(), { from: "2026-08-19T21:00:00" })).status).toBe(400);
    expect((await readSession(session.id)).pauses).toEqual([]);
  });
});

describe("ending and correcting a pause — PATCH …/pauses/:id", () => {
  test("`toMs` ends it: the server stores the reading of that moment", async () => {
    const pause = await beginPause(new Date(2026, 7, 19, 21, 40, 12));
    const ended = await endPause(pause, new Date(2026, 7, 19, 21, 58, 3));
    expect(ended).toEqual({
      id: pause.id,
      from: "2026-08-19T21:40:12",
      fromMs: new Date(2026, 7, 19, 21, 40, 12).getTime(),
      to: "2026-08-19T21:58:03",
      toMs: new Date(2026, 7, 19, 21, 58, 3).getTime(),
      rev: pause.rev + 1,
    });
    const read = await readSession(session.id);
    expect(read.pauses).toEqual([ended]);
    expect(read.log).toEqual([]);
    expect(read.rev).toBe(session.rev);
  });

  test("a pause of an ended session can still be corrected", async () => {
    const [pause] = (await readSession(FIXTURE_SESSION)).pauses;
    const res = await send("PATCH", `${pausesUrl(FIXTURE_SESSION)}/${pause!.id}`, {
      rev: pause!.rev,
      fromMs: new Date(2026, 0, 15, 20, 35).getTime(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Pause).from).toBe("2026-01-15T20:35:00");
  });

  test("400 for the strings `from` and `to` — a moment is an epoch value", async () => {
    const pause = await beginPause(new Date(2026, 7, 19, 21, 40));
    for (const field of [{ to: "2026-08-19T21:50:00" }, { from: "2026-08-19T21:30:00" }]) {
      const res = await send("PATCH", `${pausesUrl()}/${pause.id}`, { rev: pause.rev, ...field });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(Object.keys(field)[0]!);
    }
    expect((await readSession(session.id)).pauses).toEqual([pause]);
  });

  test("naming no field is 400 nothing_to_write", async () => {
    const pause = await beginPause(new Date(2026, 7, 19, 21, 40));
    const res = await send("PATCH", `${pausesUrl()}/${pause.id}`, { rev: pause.rev });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "nothing_to_write" });
  });

  test("a stale rev is 409 with the current pause; force writes on top of it", async () => {
    const pause = await beginPause(new Date(2026, 7, 19, 21, 40));
    const to = new Date(2026, 7, 19, 21, 50).getTime();
    const stale = await send("PATCH", `${pausesUrl()}/${pause.id}`, { rev: pause.rev + 1, toMs: to });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: expect.any(String),
      code: "rev_conflict",
      rev: pause.rev,
      pause,
    });
    const forced = await send("PATCH", `${pausesUrl()}/${pause.id}`, {
      rev: pause.rev + 1,
      force: true,
      toMs: to,
    });
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as Pause).toMs).toBe(to);
  });

  test("404 for an unknown pause or session", async () => {
    expect((await send("PATCH", `${pausesUrl()}/gibt-es-nicht`, { rev: 1, toMs: 0 })).status).toBe(
      404,
    );
    expect(
      (await send("PATCH", `${pausesUrl("gibt-es-nicht")}/abendessen`, { rev: 1, toMs: 0 })).status,
    ).toBe(404);
  });
});
