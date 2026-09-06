// Pausing the session for real (issue #40 AK8): POST /session/pause opens a
// `pauses` interval, POST /session/continue closes it, and the FileResponse
// carries the epoch arithmetic (pausedMs / pausedSinceMs) so the client only
// ever subtracts numbers.
//
// After the SQLite cutover (issue #57) an interval is a `session_pauses` row
// and a `— Pause` line is a `log_entries` row; both are rendered back into
// the same FileResponse the client always read (store/render.ts). So the
// assertions read the RESPONSE instead of the file on disk, and each case
// gets a fresh in-memory database seeded from examples/
// (test/support/store.ts). The clock is still overridden via setNow().
//
// One value shifted with the cutover and is worth knowing while reading:
// pause timestamps are stored verbatim as `localDateTimeSeconds` writes them,
// so a `:00` second no longer disappears on the way back through the YAML
// parser. Only a MIGRATED pause carries the parser's normalization — which is
// exactly what the degradation case below shows.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { setNow } from "../src/clock";
import {
  dropStore,
  removeTempRoot,
  seedStore,
  tempCampaignRoot,
} from "./support/store";

/**
 * Path of the HAND-WRITTEN session file some cases seed. Its id is a DATE —
 * the shape every campaign written before issue #58 carries, and still a
 * perfectly valid id (a session id is an opaque string now, so nothing parses
 * it). Sessions the API starts get a random id instead: see `startedPath`.
 */
const REL = "sessions/2026-08-19";

let tmpRoot: string | undefined;
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
async function ok(url: string): Promise<FileResponse> {
  const res = await post(url);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

/** The session as the API renders it right now. */
async function session(): Promise<FileResponse> {
  const res = await app.request("/api/beispiel/session");
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

/** Log lines of the rendered session body, in order. */
function logLines(file: FileResponse): string[] {
  return file.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
}

/**
 * Seed from a temp copy of examples/ that holds a hand-written session file —
 * the only remaining way a session can carry properties the API would never
 * write itself (the migration is the single reader of the tree now).
 */
async function seedWithSessionFile(tail: string): Promise<void> {
  tmpRoot = await tempCampaignRoot();
  const abs = path.join(tmpRoot, "beispiel", `${REL}.md`);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(
    abs,
    `---\nid: 2026-08-19\nstarted: 2026-08-19T21:00\n${tail}---\n\n## Log\n`,
    "utf8",
  );
  await seedStore(tmpRoot);
}

beforeEach(async () => {
  // The running session of every case: started 21:00, clock at 21:05 unless
  // the case moves it.
  setNow(() => new Date(2026, 7, 19, 21, 0));
  await seedStore();
  startedPath = (await ok("/api/beispiel/session/start")).path;
  setNow(() => new Date(2026, 7, 19, 21, 5));
});

afterEach(async () => {
  dropStore();
  setNow(null);
  if (tmpRoot !== undefined) await removeTempRoot(tmpRoot);
  tmpRoot = undefined;
});

describe("POST /api/:campaign/session/pause + /continue", () => {
  test("pause opens an interval and logs `— Pause`; continue closes it and logs `— Weiter`", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 40, 12));
    const paused = await ok("/api/beispiel/session/pause");
    expect(paused.path).toBe(startedPath);
    expect(paused.properties.pauses).toEqual([{ from: "2026-08-19T21:40:12" }]);
    // Nothing counted yet, but the clock is standing since 21:40:12.
    expect(paused.pausedMs).toBeUndefined();
    expect(paused.pausedSinceMs).toBe(new Date(2026, 7, 19, 21, 40, 12).getTime());
    expect(logLines(paused)).toEqual(["- 21:40 — Pause"]);

    setNow(() => new Date(2026, 7, 19, 21, 58, 3));
    const running = await ok("/api/beispiel/session/continue");
    expect(running.properties.pauses).toEqual([
      { from: "2026-08-19T21:40:12", to: "2026-08-19T21:58:03" },
    ]);
    expect(running.pausedSinceMs).toBeUndefined();
    expect(running.pausedMs).toBe((17 * 60 + 51) * 1000);
    expect(logLines(running)).toEqual(["- 21:40 — Pause", "- 21:58 — Weiter"]);
    // Seconds survive into the rendered document, so a hand-edit sees them.
    expect(running.raw).toContain("2026-08-19T21:40:12");
    // …and the state is in the database, not in the response: a plain GET
    // answers with the same intervals.
    expect((await session()).properties.pauses).toEqual(running.properties.pauses);
  });

  test("several pauses add up; the log stays append-only", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 10, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 21, 20, 0));
    await ok("/api/beispiel/session/continue");
    setNow(() => new Date(2026, 7, 19, 22, 0, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 22, 5, 30));
    const file = await ok("/api/beispiel/session/continue");
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
    setNow(() => new Date(2026, 7, 19, 21, 30, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 21, 31, 0));
    const again = await ok("/api/beispiel/session/pause");
    // The pause is unchanged — same `from` (second-precise as written, no
    // YAML roundtrip to drop the `:00` any more) and no second entry.
    expect(again.properties.pauses).toEqual([{ from: "2026-08-19T21:30:00" }]);
    expect(logLines(again)).toEqual(["- 21:30 — Pause"]);

    setNow(() => new Date(2026, 7, 19, 21, 35, 0));
    await ok("/api/beispiel/session/continue");
    setNow(() => new Date(2026, 7, 19, 21, 36, 0));
    const stillRunning = await ok("/api/beispiel/session/continue");
    expect(stillRunning.properties.pauses).toEqual([
      { from: "2026-08-19T21:30:00", to: "2026-08-19T21:35:00" },
    ]);
    expect(logLines(stillRunning)).toEqual(["- 21:30 — Pause", "- 21:35 — Weiter"]);
  });

  test("`session/end` closes an open pause", async () => {
    setNow(() => new Date(2026, 7, 19, 22, 50, 0));
    await ok("/api/beispiel/session/pause");
    setNow(() => new Date(2026, 7, 19, 23, 0, 0));
    const ended = await ok("/api/beispiel/session/end");
    expect(ended.properties.ended).toBe("2026-08-19T23:00:00");
    expect(ended.properties.pauses).toEqual([
      { from: "2026-08-19T22:50:00", to: "2026-08-19T23:00:00" },
    ]);
    expect(ended.pausedSinceMs).toBeUndefined();
    expect(ended.pausedMs).toBe(10 * 60 * 1000);
  });

  test("degraded `pauses` entries are dropped by the migration, never fatal", async () => {
    // Hand-edited garbage of every shape the field can grow: a scalar entry,
    // a mapping without `from`, an unreadable `from`, an unreadable `to` —
    // plus ONE usable closed interval. The import keeps only what
    // `sessionPauses` (shared) accepts and reports the rest; the API then
    // sees a session with exactly one interval.
    await seedWithSessionFile(
      "pauses: [kaputt, {to: 2026-08-19T21:10}, {from: gestern}, " +
        "{from: 2026-08-19T21:20:00, to: irgendwann}, " +
        "{from: 2026-08-19T21:30:00, to: 2026-08-19T21:33:00}]\n",
    );
    const file = await session();
    expect(file.pausedMs).toBe(3 * 60 * 1000);
    expect(file.pausedSinceMs).toBeUndefined();

    // …and a pause on top of that keeps the surviving entry and appends one.
    // The migrated `from`/`to` went through the YAML normalization (a `:00`
    // second is dropped there), the new one is written second-precise.
    setNow(() => new Date(2026, 7, 19, 21, 40, 0));
    const paused = await ok("/api/beispiel/session/pause");
    expect(paused.properties.pauses).toEqual([
      { from: "2026-08-19T21:30", to: "2026-08-19T21:33" },
      { from: "2026-08-19T21:40:00" },
    ]);
    expect(paused.pausedSinceMs).toBe(new Date(2026, 7, 19, 21, 40, 0).getTime());
  });

  test("404 when no session is running", async () => {
    expect((await post("/api/beispiel/session/end")).status).toBe(200);
    expect((await post("/api/beispiel/session/pause")).status).toBe(404);
    expect((await post("/api/beispiel/session/continue")).status).toBe(404);
  });
});
