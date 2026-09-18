// Pausing the session for real: POST /session/pause opens a `pauses`
// interval, POST /session/continue closes it, and every interval carries the
// SERVER's epoch reading of its two zone-less strings (`fromMs`/`toMs`) so
// the client only ever subtracts numbers.
//
// That arithmetic — paused time is the sum of the CLOSED intervals, and the
// clock stands while one is open — is the client's, and the two helpers below
// are it. It lives there and not in the response because the intervals are
// what the row holds; a `pausedMs` beside them would be a second truth about
// the same numbers.
//
// An interval is a `session_pauses` row and NOTHING ELSE: a pause writes no
// log row, because the `— Pause` line was the same pause written a second
// time (ADR #26). So the log is asserted to stay EMPTY, which is what says
// the marker rows are gone. Each case gets a fresh in-memory database seeded
// from the JSON entries in `fixtures/` (test/support/store.ts), and the
// system time is faked per case.
//
// Pause timestamps are stored VERBATIM in the `LOCAL_DATE_TIME_SECONDS` shape,
// so a `:00` second survives — which is what several assertions below spell
// out second-precise.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { SessionResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

/** The session `beforeEach` started — this case's opaque id. */
let startedId: string;

async function post(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** POST that must succeed, with the session it answers with. */
async function ok(url: string): Promise<SessionResponse> {
  const res = await post(url);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

/** The ACTIVE session right now — `null` when none runs. */
async function session(): Promise<SessionResponse> {
  const res = await app.request("/api/campaigns/beispiel/session");
  expect(res.status).toBe(200);
  const body = (await res.json()) as SessionResponse | null;
  expect(body).not.toBeNull();
  return body as SessionResponse;
}

/** The pauses as the wall-clock pairs the row holds, without the readings. */
function intervals(entry: SessionResponse): Array<{ from: string; to?: string }> {
  return entry.pauses.map((p) => ({ from: p.from, ...(p.to === undefined ? {} : { to: p.to }) }));
}

/**
 * THE CLIENT'S ARITHMETIC, the half that counts: the summed length of the
 * CLOSED intervals, in milliseconds, or undefined when none is closed.
 */
function pausedMs(entry: SessionResponse): number | undefined {
  let total = 0;
  for (const pause of entry.pauses) {
    if (pause.fromMs === undefined || pause.toMs === undefined) continue;
    total += Math.max(0, pause.toMs - pause.fromMs);
  }
  return total === 0 ? undefined : total;
}

/** The other half: since when the clock stands, or undefined when it runs. */
function pausedSinceMs(entry: SessionResponse): number | undefined {
  const open = entry.pauses.filter((p) => p.to === undefined);
  return open[open.length - 1]?.fromMs;
}

/**
 * Re-seed with a RUNNING session that already carries pause intervals — a
 * session from an earlier evening, which no endpoint can produce in one call.
 */
async function seedWithPauses(
  pauses: Array<{ from: string; to?: string }>,
): Promise<void> {
  await seedStore({
    entries: [
      {
        kind: "session",
        properties: {
          id: "2026-08-19",
          started: "2026-08-19T21:00:00",
          scenes_played: [],
          pauses,
        },
        body: "",
        log: [],
      },
    ],
  });
}

beforeEach(async () => {
  // The running session of every case: started 21:00, clock at 21:05 unless
  // the case moves it.
  setSystemTime(new Date(2026, 7, 19, 21, 0));
  await seedStore();
  startedId = (await ok("/api/campaigns/beispiel/session/start")).id;
  setSystemTime(new Date(2026, 7, 19, 21, 5));
});

afterEach(async () => {
  dropStore();
  setSystemTime();
});

describe("POST /api/campaigns/:campaign/session/pause + /continue", () => {
  test("pause opens an interval, continue closes it — and neither writes a log row", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 40, 12));
    const paused = await ok("/api/campaigns/beispiel/session/pause");
    expect(paused.id).toBe(startedId);
    // The interval travels with BOTH readings of its open end.
    expect(paused.pauses).toEqual([
      {
        from: "2026-08-19T21:40:12",
        fromMs: new Date(2026, 7, 19, 21, 40, 12).getTime(),
      },
    ]);
    // Nothing counted yet, but the clock is standing since 21:40:12.
    expect(pausedMs(paused)).toBeUndefined();
    expect(pausedSinceMs(paused)).toBe(new Date(2026, 7, 19, 21, 40, 12).getTime());
    expect(paused.log).toEqual([]);

    setSystemTime(new Date(2026, 7, 19, 21, 58, 3));
    const running = await ok("/api/campaigns/beispiel/session/continue");
    expect(running.pauses).toEqual([
      {
        from: "2026-08-19T21:40:12",
        fromMs: new Date(2026, 7, 19, 21, 40, 12).getTime(),
        to: "2026-08-19T21:58:03",
        toMs: new Date(2026, 7, 19, 21, 58, 3).getTime(),
      },
    ]);
    expect(pausedSinceMs(running)).toBeUndefined();
    expect(pausedMs(running)).toBe((17 * 60 + 51) * 1000);
    expect(running.log).toEqual([]);
    // Seconds survive into the stored intervals verbatim.
    expect(running.pauses[0]?.from).toBe("2026-08-19T21:40:12");
    // …and the state is in the database, not in the response: a plain GET
    // answers with the same intervals.
    expect((await session()).pauses).toEqual(running.pauses);
  });

  test("several pauses add up; none of them reaches the log", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 10, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 21, 20, 0));
    await ok("/api/campaigns/beispiel/session/continue");
    setSystemTime(new Date(2026, 7, 19, 22, 0, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 22, 5, 30));
    const entry = await ok("/api/campaigns/beispiel/session/continue");
    expect(pausedMs(entry)).toBe((10 * 60 + 5 * 60 + 30) * 1000);
    expect(entry.pauses.length).toBe(2);
    expect(entry.log).toEqual([]);
  });

  test("both calls are idempotent — no second interval", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 30, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 21, 31, 0));
    const again = await ok("/api/campaigns/beispiel/session/pause");
    // The pause is unchanged — same `from` (second-precise as written, no
    // YAML roundtrip to drop the `:00` any more) and no second entry.
    expect(intervals(again)).toEqual([{ from: "2026-08-19T21:30:00" }]);
    expect(again.log).toEqual([]);

    setSystemTime(new Date(2026, 7, 19, 21, 35, 0));
    await ok("/api/campaigns/beispiel/session/continue");
    setSystemTime(new Date(2026, 7, 19, 21, 36, 0));
    const stillRunning = await ok("/api/campaigns/beispiel/session/continue");
    expect(intervals(stillRunning)).toEqual([
      { from: "2026-08-19T21:30:00", to: "2026-08-19T21:35:00" },
    ]);
    expect(stillRunning.log).toEqual([]);
  });

  test("`session/end` closes an open pause", async () => {
    setSystemTime(new Date(2026, 7, 19, 22, 50, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 23, 0, 0));
    const ended = await ok("/api/campaigns/beispiel/session/end");
    expect(ended.ended).toBe("2026-08-19T23:00:00");
    expect(intervals(ended)).toEqual([
      { from: "2026-08-19T22:50:00", to: "2026-08-19T23:00:00" },
    ]);
    expect(pausedSinceMs(ended)).toBeUndefined();
    expect(pausedMs(ended)).toBe(10 * 60 * 1000);
  });

  test("a session that already carries intervals counts them, and a pause APPENDS", async () => {
    await seedWithPauses([{ from: "2026-08-19T21:30:00", to: "2026-08-19T21:33:00" }]);
    const entry = await session();
    expect(pausedMs(entry)).toBe(3 * 60 * 1000);
    expect(pausedSinceMs(entry)).toBeUndefined();

    // A pause on top keeps the stored interval verbatim and adds an open one.
    setSystemTime(new Date(2026, 7, 19, 21, 40, 0));
    const paused = await ok("/api/campaigns/beispiel/session/pause");
    expect(intervals(paused)).toEqual([
      { from: "2026-08-19T21:30:00", to: "2026-08-19T21:33:00" },
      { from: "2026-08-19T21:40:00" },
    ]);
    expect(pausedSinceMs(paused)).toBe(new Date(2026, 7, 19, 21, 40, 0).getTime());
  });

  test("404 when no session is running", async () => {
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/campaigns/beispiel/session/pause")).status).toBe(404);
    expect((await post("/api/campaigns/beispiel/session/continue")).status).toBe(404);
  });
});
