// The session timestamps on the WRITE path: `started`, `ended` and both ends
// of a pause have one shape, and a PATCH carrying anything else is a 400.
//
// The point of these cases is the same as with the closed columns (ADR #25):
// the answer, and that the entry stays as it was. Everything else writes
// those columns from the server's own clock, so the PATCH is the one place a
// foreign value could enter — and the last case is the reason the guard
// exists at all: whatever the API accepts, the next start accepts too.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EntryResponse } from "@grimoire/shared";
import { openDb } from "../src/db/client";
import { readFixtureSources, seedCampaign } from "../src/db/seed";
import { closeStore, initStore } from "../src/store/handle";
import { app } from "../src/server";
import { dropStore, seedStore, FIXTURES } from "./support/store";
import { entriesUrl } from "./support/urls";

const SESSION = "sessions/2026-01-15";

async function read(rel = SESSION): Promise<EntryResponse> {
  const res = await app.request(entriesUrl("beispiel", rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

async function patch(properties: Record<string, unknown>, rev: number): Promise<Response> {
  return app.request(entriesUrl("beispiel", SESSION), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, properties }),
  });
}

interface Refusal {
  code: string;
  error: string;
  field: string;
  value: string;
}

/** PATCH a foreign timestamp and read the refusal — nothing may be written. */
async function refusal(properties: Record<string, unknown>): Promise<Refusal> {
  const before = await read();
  const res = await patch(properties, before.rev);
  expect(res.status).toBe(400);
  const after = await read();
  // Nothing was written: the guard token has not moved and neither have the
  // values the patch was after.
  expect(after.rev).toBe(before.rev);
  expect(after.properties).toEqual(before.properties);
  return (await res.json()) as Refusal;
}

describe("a session timestamp outside the one shape is a 400", () => {
  beforeEach(async () => {
    await seedStore();
  });
  afterEach(() => {
    dropStore();
  });

  test("a second-less `started`", async () => {
    const body = await refusal({ started: "2026-01-15T19:30" });
    expect(body.code).toBe("timestamp_not_allowed");
    expect(body.field).toBe("started");
    expect(body.value).toBe("2026-01-15T19:30");
    // The English fallback names the shape the app's sentence spells out.
    expect(body.error).toContain("yyyy-MM-dd");
  });

  test("a space instead of the `T` in `ended`", async () => {
    const body = await refusal({ ended: "2026-01-15 22:45:00" });
    expect(body.code).toBe("timestamp_not_allowed");
    expect(body.field).toBe("ended");
  });

  test("a bare date, a time without a day, a sentence", async () => {
    for (const value of ["2026-01-15", "19:30:00", "gestern abend", "2026-01-15T19:30:00Z"]) {
      const body = await refusal({ started: value });
      expect(body.code).toBe("timestamp_not_allowed");
      expect(body.value).toBe(value);
    }
  });

  test("both ends of a pause, named by their position in the list", async () => {
    const from = await refusal({
      pauses: [{ from: "2026-01-15T20:30:00", to: "2026-01-15T20:50:00" }, { from: "20:30" }],
    });
    expect(from.field).toBe("pauses[1].from");

    const to = await refusal({
      pauses: [{ from: "2026-01-15T20:30:00", to: "2026-01-15 20:50:00" }],
    });
    expect(to.field).toBe("pauses[0].to");
    expect(to.value).toBe("2026-01-15 20:50:00");
  });

  test("the canonical shape is written, and reading it back gives the moment", async () => {
    const before = await read();
    const res = await patch(
      {
        started: "2026-01-15T19:31:07",
        ended: "2026-01-15T22:45:03",
        pauses: [{ from: "2026-01-15T20:30:00", to: "2026-01-15T20:50:12" }],
      },
      before.rev,
    );
    expect(res.status).toBe(200);
    const entry = (await res.json()) as EntryResponse;
    expect(entry.properties.started).toBe("2026-01-15T19:31:07");
    expect(entry.properties.pauses).toEqual([
      { from: "2026-01-15T20:30:00", to: "2026-01-15T20:50:12" },
    ]);
    // The seconds survive into the reading the client does its arithmetic on.
    expect(entry.startedMs).toBe(new Date(2026, 0, 15, 19, 31, 7).getTime());
    expect(entry.endedMs).toBe(new Date(2026, 0, 15, 22, 45, 3).getTime());
  });

  test("`null` still clears `ended` — nothing is not a shape", async () => {
    const before = await read();
    const res = await patch({ ended: null }, before.rev);
    expect(res.status).toBe(200);
    const entry = (await res.json()) as EntryResponse;
    expect(entry.properties.ended ?? null).toBeNull();
    expect(entry.endedMs).toBeUndefined();
  });

  test("an open pause keeps its missing `to`", async () => {
    const before = await read();
    const res = await patch({ pauses: [{ from: "2026-01-15T20:30:00" }] }, before.rev);
    expect(res.status).toBe(200);
    const entry = (await res.json()) as EntryResponse;
    expect(entry.properties.pauses).toEqual([{ from: "2026-01-15T20:30:00" }]);
  });
});

describe("the boot check is out of the API's reach", () => {
  afterEach(() => {
    closeStore();
    setSystemTime();
  });

  test("every write path for a session timestamp, and then a start", async () => {
    // The gate in db/timestamp-preflight.ts refuses a database holding a
    // value the reader cannot read. This case walks the paths that write
    // those four columns — the clock-driven endpoints and the PATCH, with
    // both a refused and an accepted value — and then BOOTS the same
    // database: a shape the API let through would show up as a failed start.
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-session-timestamps-"));
    const dbPath = path.join(dir, "grimoire.db");
    try {
      closeStore();
      const db = await initStore({ dbFile: dbPath });
      const sources = await readFixtureSources(path.join(FIXTURES, "beispiel"));
      seedCampaign(
        db,
        sources.map((source) => source.entry),
      );

      setSystemTime(new Date(2026, 2, 3, 19, 30, 41));
      const started = await app.request("/api/campaigns/beispiel/session/start", {
        method: "POST",
      });
      expect(started.status).toBe(200);
      const session = (await started.json()) as EntryResponse;

      setSystemTime(new Date(2026, 2, 3, 20, 15, 9));
      expect(
        (await app.request("/api/campaigns/beispiel/session/pause", { method: "POST" })).status,
      ).toBe(200);
      setSystemTime(new Date(2026, 2, 3, 20, 41, 55));
      expect(
        (await app.request("/api/campaigns/beispiel/session/continue", { method: "POST" })).status,
      ).toBe(200);
      setSystemTime(new Date(2026, 2, 3, 23, 5, 2));
      expect(
        (await app.request("/api/campaigns/beispiel/session/end", { method: "POST" })).status,
      ).toBe(200);

      const current = await read(session.path);
      const refused = await app.request(entriesUrl("beispiel", session.path), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rev: current.rev,
          properties: {
            started: "2026-03-03T19:30",
            pauses: [{ from: "2026-03-03 20:15:09", to: "" }],
          },
        }),
      });
      expect(refused.status).toBe(400);
      const accepted = await app.request(entriesUrl("beispiel", session.path), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rev: current.rev,
          properties: {
            started: "2026-03-03T19:30:41",
            ended: "2026-03-03T23:05:02",
            pauses: [{ from: "2026-03-03T20:15:09", to: "2026-03-03T20:41:55" }],
          },
        }),
      });
      expect(accepted.status).toBe(200);
      closeStore();

      const booted = await openDb(dbPath);
      booted.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
