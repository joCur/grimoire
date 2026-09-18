// The gate in front of the status and type CHECK constraints (ADR #25):
// `findStatusProblems` names every stored value the columns will not accept,
// `statusProblemReport` turns that into the operator's log block and
// `assertStatusesReady` aborts the start with it.
//
// The gate runs on the raw client while the columns are still open, so the
// database here is built BY HAND in that open shape — the tables with the
// columns the gate reads. A database that already carries the constraints
// cannot hold a foreign value at all, and that half is asserted through the
// real boot path: `openDb` leaves nothing to check.
//
// The API half (a foreign value on a write is a 400) is asserted where the DM
// meets it, in test/status-constraints.test.ts.

import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";
import {
  assertStatusesReady,
  findStatusProblems,
  statusProblemReport,
} from "../src/db/status-preflight";

/** The tables with open columns, as the gate finds them. */
async function openColumnsDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec(`
    create table campaigns (id text primary key, name text not null default '');
    create table chapters (
      campaign_id text not null, id text not null, title text not null default '',
      status text, pos integer not null default 0,
      primary key (campaign_id, id)
    );
    create table locations (
      campaign_id text not null, id text not null, name text not null default '',
      chapter_id text,
      primary key (campaign_id, id)
    );
    create table npcs (
      campaign_id text not null, id text not null, name text not null default '',
      chapter_id text, status text not null default 'unknown',
      primary key (campaign_id, id)
    );
    create table scenes (
      campaign_id text not null, id text not null, chapter_id text, location text,
      title text not null default '', type text not null default 'planned',
      status text not null default 'draft', pos integer not null default 0,
      primary key (campaign_id, id)
    );
  `);
  return client;
}

/** One campaign whose four closed values are all inside their lists. */
function seedAllowedValues(client: SqliteClient): void {
  client.exec(`
    insert into campaigns (id, name) values ('beispiel', 'Beispiel');
    insert into chapters (campaign_id, id, title, status, pos)
      values ('beispiel', '01', 'Kapitel', 'active', 0);
    insert into locations (campaign_id, id, name, chapter_id)
      values ('beispiel', 'hafen', 'Hafen', '01');
    insert into npcs (campaign_id, id, name, chapter_id, status)
      values ('beispiel', 'jorna', 'Jorna', '01', 'alive');
    insert into scenes (campaign_id, id, chapter_id, location, title, type, status, pos)
      values ('beispiel', 'ankunft', '01', 'hafen', 'Ankunft', 'contingency', 'ready', 0);
  `);
}

function rows(client: SqliteClient, query: string): Record<string, unknown>[] {
  return client.prepare(query).all();
}

describe("the pre-flight in front of the constraints", () => {
  test("clean data has nothing to report and lets the start through", async () => {
    const client = await openColumnsDb();
    try {
      seedAllowedValues(client);
      expect(findStatusProblems(client)).toEqual([]);
      expect(() => assertStatusesReady(client)).not.toThrow();
    } finally {
      client.close();
    }
  });

  test("a database that carries the constraints is not asked", async () => {
    // Once the CHECKs are there, nothing can be outside them — the gate reads
    // that off the schema the real boot path leaves behind.
    const { client, close } = await openDb(":memory:");
    try {
      expect(findStatusProblems(client)).toEqual([]);
      expect(() => assertStatusesReady(client)).not.toThrow();
    } finally {
      close();
    }
  });

  test("a planted foreign value refuses the start, naming campaign and address", async () => {
    const client = await openColumnsDb();
    try {
      seedAllowedValues(client);
      client.exec("update scenes set status = 'halbfertig' where id = 'ankunft'");

      const problems = findStatusProblems(client);
      expect(problems).toEqual([
        {
          campaign: "beispiel",
          // The scene's address carries its location as the group segment.
          address: "01/hafen/ankunft",
          field: "status",
          value: "halbfertig",
          allowed: ["draft", "ready", "played", "dropped"],
        },
      ]);
      const report = statusProblemReport(problems).join("\n");
      expect(report).toContain("beispiel 01/hafen/ankunft");
      expect(report).toContain("halbfertig");
      expect(report).toContain("Nothing has been migrated.");
      expect(() => assertStatusesReady(client)).toThrow(/halbfertig/);
    } finally {
      client.close();
    }
  });

  test("it reports a scene type, an npc status and a chapter status too", async () => {
    const client = await openColumnsDb();
    try {
      seedAllowedValues(client);
      client.exec("update scenes set type = 'optional' where id = 'ankunft'");
      client.exec("update npcs set status = 'tot' where id = 'jorna'");
      client.exec("update chapters set status = 'begonnen' where id = '01'");

      expect(
        findStatusProblems(client).map((problem) => [
          problem.address,
          problem.field,
          problem.value,
        ]),
      ).toEqual([
        ["01", "status", "begonnen"],
        ["01/hafen/ankunft", "type", "optional"],
        ["npcs/jorna", "status", "tot"],
      ]);
    } finally {
      client.close();
    }
  });

  test("a chapter without a status is not a problem", async () => {
    const client = await openColumnsDb();
    try {
      seedAllowedValues(client);
      client.exec("update chapters set status = null where id = '01'");
      expect(findStatusProblems(client)).toEqual([]);
      expect(rows(client, "select status from chapters")).toEqual([{ status: null }]);
    } finally {
      client.close();
    }
  });
});
