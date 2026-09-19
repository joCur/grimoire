// The session timestamps on the WRITE path: `started`, `ended` and both ends
// of a pause have one shape, and `PATCH /sessions/:id` carrying anything else
// is a 400.
//
// The point of these cases is the same as with the closed columns (ADR #25):
// the answer, and that the session stays as it was. Everything else writes
// those columns from the server's own clock, so this PATCH is the one place a
// foreign value could enter — and the last case is the reason the guard
// exists at all: whatever the API accepts, the next start accepts too.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EntryResponse, SessionResponse } from "@grimoire/shared";
import { openDb } from "../src/db/client";
import type { SqliteClient } from "../src/db/driver";
import { readFixtureSources, seedCampaign } from "../src/db/seed";
import { closeStore, initStore } from "../src/store/handle";
import { app } from "../src/server";
import { dropStore, seedStore, FIXTURES } from "./support/store";

const SESSION = "2026-01-15";
const SESSION_URL = `/api/campaigns/beispiel/sessions/${SESSION}`;

async function read(): Promise<SessionResponse> {
  const res = await app.request(SESSION_URL);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionResponse;
}

async function patch(fields: Record<string, unknown>, rev: number): Promise<Response> {
  return app.request(SESSION_URL, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...fields }),
  });
}

/** The pauses as the wall-clock pairs the row holds, without the readings. */
function intervals(entry: SessionResponse): Array<{ from: string; to?: string }> {
  return entry.pauses.map((p) => ({ from: p.from, ...(p.to === undefined ? {} : { to: p.to }) }));
}

interface Refusal {
  code: string;
  error: string;
  field: string;
  value: string;
}

/** PATCH a foreign timestamp and read the refusal — nothing may be written. */
async function refusal(fields: Record<string, unknown>): Promise<Refusal> {
  const before = await read();
  const res = await patch(fields, before.rev);
  expect(res.status).toBe(400);
  // Nothing was written: the guard token has not moved and neither has
  // anything the patch was after.
  expect(await read()).toEqual(before);
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
    const entry = (await res.json()) as SessionResponse;
    expect(entry.started).toBe("2026-01-15T19:31:07");
    expect(intervals(entry)).toEqual([
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
    const entry = (await res.json()) as SessionResponse;
    expect(entry.ended).toBeUndefined();
    expect(entry.endedMs).toBeUndefined();
  });

  test("an open pause keeps its missing `to`", async () => {
    const before = await read();
    const res = await patch({ pauses: [{ from: "2026-01-15T20:30:00" }] }, before.rev);
    expect(res.status).toBe(200);
    const entry = (await res.json()) as SessionResponse;
    expect(intervals(entry)).toEqual([{ from: "2026-01-15T20:30:00" }]);
  });

  test("a field left out keeps its value; naming none of them is a 400", async () => {
    const before = await read();
    const res = await patch({ started: "2026-01-15T19:00:00" }, before.rev);
    expect(res.status).toBe(200);
    const entry = (await res.json()) as SessionResponse;
    expect(entry.started).toBe("2026-01-15T19:00:00");
    // `ended` and the pauses were not named, so they stand.
    expect(entry.ended).toBe(before.ended);
    expect(entry.pauses).toEqual(before.pauses);
    // …and so does the log, which this endpoint cannot touch at all.
    expect(entry.log).toEqual(before.log);

    const empty = await patch({}, entry.rev);
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe("nothing_to_write");
  });

  test("a stale rev is a 409 carrying the current SESSION, and writes nothing", async () => {
    const before = await read();
    const res = await patch({ started: "2026-01-15T19:00:00" }, before.rev - 1);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      rev: number;
      session: SessionResponse;
      entry?: unknown;
    };
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(before.rev);
    // The current session rides along under `session` — not `entry`: a
    // session is not an entry (ADR #26).
    expect(body.session).toEqual(before);
    expect(body.entry).toBeUndefined();
    expect(await read()).toEqual(before);
  });

  test("404 for an unknown session id", async () => {
    const res = await app.request("/api/campaigns/beispiel/sessions/gibt-es-nicht", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: 1, started: "2026-01-15T19:00:00" }),
    });
    expect(res.status).toBe(404);
  });
});

/**
 * Drop the migrator's record of the last `count` migrations, so the next open
 * applies them again. It is how a case gets a database in the state an
 * installation was in before one of them existed — the data is planted, and
 * this removes the "already done" the migrator would otherwise read.
 *
 * `count` is how far back the migration under test sits from the end, so a
 * case names that distance instead of assuming its migration is the newest.
 * Every migration after the one under test is replayed along with it, so a
 * case also has to undo what those later ones added — a database recorded
 * before a migration was recorded before its successors too.
 */
function forgetMigrations(client: SqliteClient, count: number): void {
  client.exec(
    "delete from __drizzle_migrations where rowid in" +
      ` (select rowid from __drizzle_migrations order by rowid desc limit ${count})`,
  );
}

describe("a database recorded before the seconds were written", () => {
  afterEach(() => {
    closeStore();
  });

  test("it starts, and its session reads back with the seconds completed", async () => {
    // The shape a session held before the seconds were written is
    // `yyyy-MM-ddTHH:mm`, and the boot check reads none of it. Completing it
    // is lossless — `:00` is the only second that minute's precision allows —
    // so migration 0017 does it and the start goes through.
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-minute-session-"));
    const dbPath = path.join(dir, "grimoire.db");
    try {
      const seeded = await openDb(dbPath);
      const sources = await readFixtureSources(path.join(FIXTURES, "beispiel"));
      seedCampaign(
        seeded.db,
        sources.map((source) => source.entry),
      );
      // The state an older installation is in: minute-precise values on the
      // session and on a pause, one of them with a space where the `T` is.
      seeded.client.exec(
        "update sessions set started = '2026-01-15T19:30'," +
          " ended = '2026-01-15 22:45:00' where id = '2026-01-15'",
      );
      seeded.client.exec(
        "update session_pauses set from_ts = '2026-01-15T20:30'," +
          " to_ts = '2026-01-15 20:50' where session_id = '2026-01-15'",
      );
      // And the other half of that state: the installation predates the
      // migration, so its bookkeeping row goes as well and the next open runs
      // it for the first time. Everything recorded AFTER it is replayed with
      // it, so the schema those later migrations added has to go back too —
      // an installation from before 0017 had none of it.
      seeded.client.exec("alter table chapters drop column scene_order_rev");
      forgetMigrations(seeded.client, 3);
      seeded.close();

      // The real boot path, on that database.
      await initStore({ dbFile: dbPath });
      const entry = await read();
      expect(entry.started).toBe("2026-01-15T19:30:00");
      expect(entry.ended).toBe("2026-01-15T22:45:00");
      expect(intervals(entry)).toEqual([
        { from: "2026-01-15T20:30:00", to: "2026-01-15T20:50:00" },
      ]);
      // Canonical means READABLE: the moment is there for the client's
      // arithmetic, which is what a value outside the shape loses.
      expect(entry.startedMs).toBe(new Date(2026, 0, 15, 19, 30, 0).getTime());
    } finally {
      closeStore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a shape nothing can complete still refuses the start", async () => {
    // The migration completes only what the value itself already says. A
    // time without a day is not a shape anybody can finish, so it stays and
    // the check reports it.
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-unreadable-session-"));
    const dbPath = path.join(dir, "grimoire.db");
    try {
      closeStore();
      const seeded = await openDb(dbPath);
      const sources = await readFixtureSources(path.join(FIXTURES, "beispiel"));
      seedCampaign(
        seeded.db,
        sources.map((source) => source.entry),
      );
      seeded.client.exec("update sessions set started = '19:30' where id = '2026-01-15'");
      seeded.close();

      await expect(openDb(dbPath)).rejects.toThrow(/19:30/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      const session = (await started.json()) as SessionResponse;

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

      const sessionUrl = `/api/campaigns/beispiel/sessions/${session.id}`;
      const currentRes = await app.request(sessionUrl);
      expect(currentRes.status).toBe(200);
      const current = (await currentRes.json()) as SessionResponse;
      const refused = await app.request(sessionUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rev: current.rev,
          started: "2026-03-03T19:30",
          pauses: [{ from: "2026-03-03 20:15:09", to: "" }],
        }),
      });
      expect(refused.status).toBe(400);
      const accepted = await app.request(sessionUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rev: current.rev,
          started: "2026-03-03T19:30:41",
          ended: "2026-03-03T23:05:02",
          pauses: [{ from: "2026-03-03T20:15:09", to: "2026-03-03T20:41:55" }],
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
