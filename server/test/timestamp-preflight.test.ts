// The gate in front of the session timestamps: `findTimestampProblems` names
// every stored value outside the one shape (store/time.ts),
// `timestampProblemReport` turns that into the operator's log block and
// `assertTimestampsReady` aborts the start with it.
//
// The gate is what lets the reader be strict, so the cases here are the
// shapes a direct database write could leave behind — the app itself produces
// none of them. Nothing is corrected: the value stays in the column, verbatim.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db/client";
import { readFixtureSources, seedCampaign } from "../src/db/seed";
import { openSqlite, type SqliteClient } from "../src/db/driver";
import {
  assertTimestampsReady,
  findTimestampProblems,
  timestampProblemReport,
} from "../src/db/timestamp-preflight";
import { FIXTURES } from "./support/store";

/** The example campaign the fixtures describe. */
const FIXTURES_BEISPIEL = path.join(FIXTURES, "beispiel");

/** The two session tables, as the gate finds them. */
async function openSessionsDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec(`
    create table sessions (
      campaign_id text not null, id text not null, started text, ended text,
      primary key (campaign_id, id)
    );
    create table session_pauses (
      campaign_id text not null, session_id text not null, pos integer not null,
      from_ts text not null, to_ts text,
      primary key (campaign_id, session_id, pos)
    );
  `);
  return client;
}

/** A running session with one closed pause — every value in the one shape. */
function seedCanonical(client: SqliteClient): void {
  client.exec(`
    insert into sessions (campaign_id, id, started, ended)
      values ('beispiel', 'a0a2', '2026-08-19T21:05:00', null);
    insert into session_pauses (campaign_id, session_id, pos, from_ts, to_ts)
      values ('beispiel', 'a0a2', 0, '2026-08-19T21:30:00', '2026-08-19T21:33:00');
  `);
}

function values(client: SqliteClient, query: string): Record<string, unknown>[] {
  return client.prepare(query).all();
}

describe("the pre-flight in front of the session timestamps", () => {
  test("canonical values have nothing to report and let the start through", async () => {
    const client = await openSessionsDb();
    try {
      seedCanonical(client);
      expect(findTimestampProblems(client)).toEqual([]);
      expect(() => assertTimestampsReady(client)).not.toThrow();
    } finally {
      client.close();
    }
  });

  test("a database without session tables is not asked", async () => {
    const client = await openSqlite(":memory:");
    try {
      expect(findTimestampProblems(client)).toEqual([]);
      expect(() => assertTimestampsReady(client)).not.toThrow();
    } finally {
      client.close();
    }
  });

  test("the committed fixtures pass the gate, and the boot refuses a planted value", async () => {
    // The seed writes `started`, `ended` and the pauses VERBATIM, so a
    // fixture in another shape would be caught here — and the second half is
    // the real boot path on the same database: what the gate finds, `openDb`
    // refuses to start on.
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-timestamps-"));
    const dbPath = path.join(dir, "grimoire.db");
    const seeded = await openDb(dbPath);
    try {
      const sources = await readFixtureSources(FIXTURES_BEISPIEL);
      seedCampaign(
        seeded.db,
        sources.map((source) => source.entry),
      );
      expect(findTimestampProblems(seeded.client)).toEqual([]);
      seeded.client.exec("update sessions set started = '2026-01-15 19:30:00'");
    } finally {
      seeded.close();
    }
    await expect(openDb(dbPath)).rejects.toThrow(/2026-01-15 19:30:00/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a second-less `started` refuses the start, naming session, column and value", async () => {
    const client = await openSessionsDb();
    try {
      seedCanonical(client);
      client.exec("update sessions set started = '2026-08-19T21:05' where id = 'a0a2'");

      const problems = findTimestampProblems(client);
      expect(problems).toEqual([
        {
          campaign: "beispiel",
          session: "a0a2",
          column: "started",
          value: "2026-08-19T21:05",
        },
      ]);
      const report = timestampProblemReport(problems).join("\n");
      expect(report).toContain("beispiel sessions/a0a2");
      expect(report).toContain("2026-08-19T21:05");
      expect(report).toContain("yyyy-MM-dd");
      expect(() => assertTimestampsReady(client)).toThrow(/started/);
      // Nothing corrected: the value is still there, verbatim.
      expect(values(client, "select started from sessions")).toEqual([
        { started: "2026-08-19T21:05" },
      ]);
    } finally {
      client.close();
    }
  });

  test("it reports `ended` and both ends of a pause too", async () => {
    const client = await openSessionsDb();
    try {
      seedCanonical(client);
      client.exec("update sessions set ended = '2026-08-19' where id = 'a0a2'");
      client.exec(
        "update session_pauses set from_ts = '2026-08-19 21:30:00'," +
          " to_ts = 'gestern abend' where pos = 0",
      );

      expect(
        findTimestampProblems(client).map((problem) => [problem.column, problem.value]),
      ).toEqual([
        ["ended", "2026-08-19"],
        ["from_ts", "2026-08-19 21:30:00"],
        ["to_ts", "gestern abend"],
      ]);
    } finally {
      client.close();
    }
  });

  test("an empty value is 'not set', not a problem", async () => {
    // A running session has no `ended` and an open pause no `to_ts`; a blank
    // string reads the same way (@grimoire/shared `isEnded`).
    const client = await openSessionsDb();
    try {
      seedCanonical(client);
      client.exec("update sessions set ended = '  ' where id = 'a0a2'");
      client.exec("update session_pauses set to_ts = null where pos = 0");
      expect(findTimestampProblems(client)).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("a fresh database starts", async () => {
    const { client, close } = await openDb(":memory:");
    try {
      expect(findTimestampProblems(client)).toEqual([]);
      expect(() => assertTimestampsReady(client)).not.toThrow();
    } finally {
      close();
    }
  });
});
