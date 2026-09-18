// Pausing the session for real: POST /session/pause opens a `pauses`
// interval, POST /session/continue closes it, and the EntryResponse carries
// the epoch arithmetic (pausedMs / pausedSinceMs) so the client only ever
// subtracts numbers.
//
// An interval is a `session_pauses` row and a `— Pause` line is a
// `log_entries` row; both are rendered back into the EntryResponse the client
// reads (store/render.ts), so the assertions read the RESPONSE. Each case
// gets a fresh in-memory database seeded from the JSON entries in `fixtures/`
// (test/support/store.ts), and the system time is faked per case.
//
// Pause timestamps are stored VERBATIM as `localDateTimeSeconds` writes them,
// so a `:00` second survives — which is what several assertions below spell
// out second-precise.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntryResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

/** Path of the session `beforeEach` started — this case's opaque id. */
let startedPath: string;

async function post(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** POST that must succeed, with the session it answers with. */
async function ok(url: string): Promise<EntryResponse> {
  const res = await post(url);
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** The session as the API renders it right now. */
async function session(): Promise<EntryResponse> {
  const res = await app.request("/api/campaigns/beispiel/session");
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** Log lines of the rendered session body, in order. */
function logLines(file: EntryResponse): string[] {
  return file.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
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
          started: "2026-08-19T21:00",
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
  startedPath = (await ok("/api/campaigns/beispiel/session/start")).path;
  setSystemTime(new Date(2026, 7, 19, 21, 5));
});

afterEach(async () => {
  dropStore();
  setSystemTime();
});

describe("POST /api/campaigns/:campaign/session/pause + /continue", () => {
  test("pause opens an interval and logs `— Pause`; continue closes it and logs `— Weiter`", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 40, 12));
    const paused = await ok("/api/campaigns/beispiel/session/pause");
    expect(paused.path).toBe(startedPath);
    expect(paused.properties.pauses).toEqual([{ from: "2026-08-19T21:40:12" }]);
    // Nothing counted yet, but the clock is standing since 21:40:12.
    expect(paused.pausedMs).toBeUndefined();
    expect(paused.pausedSinceMs).toBe(new Date(2026, 7, 19, 21, 40, 12).getTime());
    expect(logLines(paused)).toEqual(["- 21:40 — Pause"]);

    setSystemTime(new Date(2026, 7, 19, 21, 58, 3));
    const running = await ok("/api/campaigns/beispiel/session/continue");
    expect(running.properties.pauses).toEqual([
      { from: "2026-08-19T21:40:12", to: "2026-08-19T21:58:03" },
    ]);
    expect(running.pausedSinceMs).toBeUndefined();
    expect(running.pausedMs).toBe((17 * 60 + 51) * 1000);
    expect(logLines(running)).toEqual(["- 21:40 — Pause", "- 21:58 — Weiter"]);
    // Seconds survive into the stored intervals.
    expect(JSON.stringify(running.properties.pauses)).toContain("2026-08-19T21:40:12");
    // …and the state is in the database, not in the response: a plain GET
    // answers with the same intervals.
    expect((await session()).properties.pauses).toEqual(running.properties.pauses);
  });

  test("several pauses add up; the log stays append-only", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 10, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 21, 20, 0));
    await ok("/api/campaigns/beispiel/session/continue");
    setSystemTime(new Date(2026, 7, 19, 22, 0, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 22, 5, 30));
    const file = await ok("/api/campaigns/beispiel/session/continue");
    expect(file.pausedMs).toBe((10 * 60 + 5 * 60 + 30) * 1000);
    expect((file.properties.pauses as unknown[]).length).toBe(2);
    expect(logLines(file)).toEqual([
      "- 21:10 — Pause",
      "- 21:20 — Weiter",
      "- 22:00 — Pause",
      "- 22:05 — Weiter",
    ]);
  });

  test("both calls are idempotent — no second interval, no duplicate log line", async () => {
    setSystemTime(new Date(2026, 7, 19, 21, 30, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 21, 31, 0));
    const again = await ok("/api/campaigns/beispiel/session/pause");
    // The pause is unchanged — same `from` (second-precise as written, no
    // YAML roundtrip to drop the `:00` any more) and no second entry.
    expect(again.properties.pauses).toEqual([{ from: "2026-08-19T21:30:00" }]);
    expect(logLines(again)).toEqual(["- 21:30 — Pause"]);

    setSystemTime(new Date(2026, 7, 19, 21, 35, 0));
    await ok("/api/campaigns/beispiel/session/continue");
    setSystemTime(new Date(2026, 7, 19, 21, 36, 0));
    const stillRunning = await ok("/api/campaigns/beispiel/session/continue");
    expect(stillRunning.properties.pauses).toEqual([
      { from: "2026-08-19T21:30:00", to: "2026-08-19T21:35:00" },
    ]);
    expect(logLines(stillRunning)).toEqual(["- 21:30 — Pause", "- 21:35 — Weiter"]);
  });

  test("`session/end` closes an open pause", async () => {
    setSystemTime(new Date(2026, 7, 19, 22, 50, 0));
    await ok("/api/campaigns/beispiel/session/pause");
    setSystemTime(new Date(2026, 7, 19, 23, 0, 0));
    const ended = await ok("/api/campaigns/beispiel/session/end");
    expect(ended.properties.ended).toBe("2026-08-19T23:00:00");
    expect(ended.properties.pauses).toEqual([
      { from: "2026-08-19T22:50:00", to: "2026-08-19T23:00:00" },
    ]);
    expect(ended.pausedSinceMs).toBeUndefined();
    expect(ended.pausedMs).toBe(10 * 60 * 1000);
  });

  test("a session that already carries intervals counts them, and a pause APPENDS", async () => {
    await seedWithPauses([{ from: "2026-08-19T21:30", to: "2026-08-19T21:33" }]);
    const file = await session();
    expect(file.pausedMs).toBe(3 * 60 * 1000);
    expect(file.pausedSinceMs).toBeUndefined();

    // A pause on top keeps the stored interval verbatim and adds an open one.
    setSystemTime(new Date(2026, 7, 19, 21, 40, 0));
    const paused = await ok("/api/campaigns/beispiel/session/pause");
    expect(paused.properties.pauses).toEqual([
      { from: "2026-08-19T21:30", to: "2026-08-19T21:33" },
      { from: "2026-08-19T21:40:00" },
    ]);
    expect(paused.pausedSinceMs).toBe(new Date(2026, 7, 19, 21, 40, 0).getTime());
  });

  test("404 when no session is running", async () => {
    expect((await post("/api/campaigns/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/campaigns/beispiel/session/pause")).status).toBe(404);
    expect((await post("/api/campaigns/beispiel/session/continue")).status).toBe(404);
  });
});
