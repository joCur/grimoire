// The gate in front of migration 0018, and the migration it guards.
//
// Two halves, both asserted here because neither means much alone:
//
//   * `findListRowProblems` names every log and inbox row the migration could
//     not turn into a note, and `assertListRowsReady` aborts the start with
//     the report. The gate reads the PRE-migration shape — a `raw` column next
//     to the parsed columns — so those databases are built by hand.
//   * a database in that shape which the gate PASSES boots through the real
//     path and reads back as rows: the skeleton rows are gone, the notes are
//     intact and `pos` is a gap-less sequence again.
//
// The second half is the behaviour the migration enables, not the migration
// itself: the assertions read the API's answer, never the SQL.

import { afterEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";
import {
  assertListRowsReady,
  findListRowProblems,
  listRowProblemReport,
} from "../src/db/list-rows-preflight";
import { closeStore, getDb, initStore } from "../src/store/handle";
import { readInbox } from "../src/store/inbox";
import { readSession } from "../src/store/sessions";
import { seedCampaign } from "../src/db/seed";
import { logLineId } from "../src/store/body-parse";

/** The two list tables in their PRE-0018 shape: `raw` beside the parse. */
async function openPreMigrationDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec(`
    create table log_entries (
      campaign_id text not null, session_id text not null, pos integer not null,
      raw text not null, at text, scene_id text, text text,
      hash text not null default '', reviewed integer not null default 0,
      primary key (campaign_id, session_id, pos)
    );
    create table inbox_entries (
      campaign_id text not null, pos integer not null,
      raw text not null, text text, done integer not null default 0,
      primary key (campaign_id, pos)
    );
  `);
  return client;
}

describe("findListRowProblems", () => {
  test("a row whose text the old parse left empty refuses the start", async () => {
    const client = await openPreMigrationDb();
    // A hand-typed log line the grammar never recognised, and a piece of
    // prose in the middle of the inbox. Neither can become a note.
    client.exec(`
      insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text)
        values ('beispiel', '2026-01-15', 3, 'kein Listeneintrag', null, null, null);
      insert into inbox_entries (campaign_id, pos, raw, text)
        values ('beispiel', 2, 'Freitext ohne Marker', null);
    `);
    const problems = findListRowProblems(client);
    expect(problems).toEqual([
      {
        campaign: "beispiel",
        list: "sessions/2026-01-15",
        position: 3,
        line: "kein Listeneintrag",
      },
      { campaign: "beispiel", list: "inbox", position: 2, line: "Freitext ohne Marker" },
    ]);

    // The report names all four things the DM needs to find the row.
    const report = listRowProblemReport(problems);
    expect(report[0]).toContain("hold no text");
    expect(report.join("\n")).toContain("beispiel sessions/2026-01-15 position 3");
    expect(report.join("\n")).toContain('"kein Listeneintrag"');
    expect(report[report.length - 1]).toContain("Nothing has been changed");

    expect(() => assertListRowsReady(client)).toThrow(/hold no text/);
    client.close();
  });

  test("the skeleton rows are not problems — the migration deletes them", async () => {
    const client = await openPreMigrationDb();
    client.exec(`
      insert into inbox_entries (campaign_id, pos, raw, text)
        values ('beispiel', 0, '## Eingang', null);
      insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text)
        values ('beispiel', 's', 1, '- 20:30 — Pause', '20:30', null, '— Pause');
    `);
    expect(findListRowProblems(client)).toEqual([]);
    expect(() => assertListRowsReady(client)).not.toThrow();
    client.close();
  });

  test("a row that HAS a text is never a problem", async () => {
    const client = await openPreMigrationDb();
    client.exec(`
      insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text)
        values ('beispiel', 's', 0, '- 19:52 Spuren gefunden', '19:52', null, 'Spuren gefunden');
      insert into inbox_entries (campaign_id, pos, raw, text)
        values ('beispiel', 1, '- Eine Idee', 'Eine Idee');
    `);
    expect(findListRowProblems(client)).toEqual([]);
    client.close();
  });

  test("a database that has been through the migration has nothing to check", async () => {
    // The real shape: no `raw` column anywhere, so the gate is a no-op.
    const opened = await openDb(":memory:");
    expect(findListRowProblems(opened.client)).toEqual([]);
    opened.close();
  });
});

describe("a database recorded while the rows still carried their line", () => {
  afterEach(() => {
    closeStore();
  });

  test("it boots, and its log and inbox read back as rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-list-rows-"));
    const dbPath = path.join(dir, "grimoire.db");
    try {
      // A real, fully migrated database is the starting point — planting the
      // tables by hand would make the migrator run from 0000 against them.
      const seeded = await openDb(dbPath);
      seedCampaign(seeded.db, [
        { kind: "campaign", properties: { id: "alt", name: "Alte Kampagne" }, body: "" },
      ]);
      // Then the state an older installation is in: the `raw` column back on
      // both list tables, the skeleton rows a markdown list needed, and a
      // `pos` that counts them.
      seeded.client.exec(`
        alter table log_entries add column raw text not null default '';
        alter table inbox_entries add column raw text not null default '';
        insert into sessions (campaign_id, id, started, ended)
          values ('alt', 's1', '2026-01-15T19:30:00', '2026-01-15T22:45:00');
        insert into log_entries (campaign_id, session_id, pos, raw, at, text, hash, reviewed)
          values ('alt', 's1', 0, '- 19:52 Erste Notiz', '19:52', 'Erste Notiz', 'abc12345', 1);
        insert into log_entries (campaign_id, session_id, pos, raw, at, text)
          values ('alt', 's1', 1, '- 20:30 — Pause', '20:30', '— Pause');
        insert into log_entries (campaign_id, session_id, pos, raw, at, text)
          values ('alt', 's1', 2, '- 21:10 — Weiter', '21:10', '— Weiter');
        insert into log_entries (campaign_id, session_id, pos, raw, at, text)
          values ('alt', 's1', 3, '- 21:20 Zweite Notiz', '21:20', 'Zweite Notiz');
        insert into inbox_entries (campaign_id, pos, raw, text)
          values ('alt', 0, '# Inbox', '');
        insert into inbox_entries (campaign_id, pos, raw, text)
          values ('alt', 1, '- Eine Idee', 'Eine Idee');
        insert into inbox_entries (campaign_id, pos, raw, text, done)
          values ('alt', 2, '- [x] Erledigte Idee', 'Erledigte Idee', 1);
      `);
      // And the other half of that state: the installation predates the
      // migration, so its bookkeeping row goes and the next open runs it.
      // Everything recorded after it replays along with it, so the schema
      // those later migrations added goes back as well — this database
      // predates them too.
      seeded.client.exec("alter table chapters drop column scene_order_rev");
      seeded.client.exec(
        "delete from __drizzle_migrations where rowid in" +
          " (select rowid from __drizzle_migrations order by rowid desc limit 2)",
      );
      seeded.close();

      // The real boot path over that database: the gate passes (every row
      // that has no text is a heading) and the migration runs.
      await initStore({ dbFile: dbPath });

      // The two marker rows are gone and the notes kept their times, their
      // texts and their review flag. The id of a row is carried over
      // UNCHANGED — the hash it already had, not a fresh one.
      const session = await readSession("alt", "s1");
      expect(session.log).toEqual([
        {
          id: "abc12345",
          at: "19:52",
          text: "Erste Notiz",
          reviewed: true,
        },
        {
          id: "",
          at: "21:20",
          text: "Zweite Notiz",
          reviewed: false,
        },
      ]);
      // A row written from here on gets its id from the columns.
      expect(logLineId("19:52", null, "Erste Notiz")).toMatch(/^[0-9a-f]{8}$/);
      // The pause itself was never in the log to begin with — it is a
      // `session_pauses` row, and this session has none.
      expect(session.pauses).toEqual([]);

      // The heading row is gone; both ideas are there, one of them ticked off,
      // and `pos` closed up so the ids start at 0 again.
      const inbox = await readInbox("alt");
      expect(inbox.entries).toEqual([
        { id: "0", text: "Eine Idee", done: false },
        { id: "1", text: "Erledigte Idee", done: true },
      ]);

      // `pos` closed up behind the deletions, so the two notes are 0 and 1
      // and the next append lands behind them rather than on top of a hole.
      const db = await getDb();
      expect(
        db
          .all<{ pos: number }>(
            sql`select pos from log_entries where campaign_id = 'alt' order by pos`,
          )
          .map((r) => r.pos),
      ).toEqual([0, 1]);
      expect(
        db
          .all<{ pos: number }>(
            sql`select pos from inbox_entries where campaign_id = 'alt' order by pos`,
          )
          .map((r) => r.pos),
      ).toEqual([0, 1]);
    } finally {
      closeStore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
