// What migration 0016 does to the data it finds — the one-time step that
// closes the status and type columns with CHECK constraints (ADR #25).
//
// WHAT IS PINNED HERE AND WHAT IS NOT: the constraints themselves are a schema
// declaration, and a test that re-asserts them would only repeat it. What IS
// pinned is the CONTENT of the migration — a released migration never changes
// again, so what it does to a DM's rows is a promise. Three tables are rebuilt
// and the migrator runs inside a transaction where `PRAGMA foreign_keys` is
// ignored, so the child rows of `scenes` and `npcs` are exactly what a careless
// rebuild would delete in silence.
//
// The API half (a foreign value on a write is a 400) is asserted where the DM
// meets it, in test/status-constraints.test.ts.
//
// The pre-migration database is the real one MINUS this migration: the
// committed files up to 0015 are applied the way the migrator applies them,
// one transaction per file. That keeps the case honest about running against
// the schema this migration actually finds, without restating it by hand.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { MIGRATIONS_DIR } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";
import {
  assertStatusesReady,
  findStatusProblems,
  statusProblemReport,
} from "../src/db/status-preflight";
import { dropStore, seedStore } from "./support/store";

/** The migration whose effect this file is about. */
const SUBJECT = "0016_status_checks.sql";

/** The statements of one committed migration, in order. */
function statementsOf(file: string): string[] {
  return readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Apply one committed migration exactly as the migrator does: one transaction. */
function apply(client: SqliteClient, file: string): void {
  client
    .transaction(() => {
      for (const statement of statementsOf(file)) client.exec(statement);
    })
    .immediate();
}

/** The schema as it stands one step BEFORE the subject: every earlier file. */
async function preCheckDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec("PRAGMA foreign_keys = ON");
  const earlier = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && name < SUBJECT)
    .sort();
  for (const file of earlier) apply(client, file);
  return client;
}

/** One campaign with a row in every table the migration touches. */
function seedCampaignRows(client: SqliteClient): void {
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
    insert into scene_npcs (campaign_id, scene_id, npc_id, pos)
      values ('beispiel', 'ankunft', 'jorna', 0);
    insert into scene_tags (campaign_id, scene_id, tag, pos)
      values ('beispiel', 'ankunft', 'social', 0);
    insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30');
    insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text, hash)
      values ('beispiel', 's1', 0, '- 19:52 (ankunft) Spuren', '19:52', 'ankunft', 'Spuren', 'abc');
    insert into session_scenes_played (campaign_id, session_id, scene_id, pos)
      values ('beispiel', 's1', 'ankunft', 0);
  `);
}

function rows(client: SqliteClient, query: string): Record<string, unknown>[] {
  return client.prepare(query).all();
}

/** The stored CREATE TABLE text of one table. */
function definitionOf(client: SqliteClient, table: string): string {
  const found = rows(
    client,
    `select sql from sqlite_master where type = 'table' and name = '${table}'`,
  );
  return String(found[0]?.sql ?? "");
}

describe("the rebuild keeps every row", () => {
  test("the child rows of the rebuilt tables survive the migration", async () => {
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
      apply(client, SUBJECT);

      // The rows whose parent tables were dropped and rebuilt around them —
      // `scene_npcs` and `scene_tags` cascade, the other two do not, and all
      // four are gone if the rebuild is done the generated way.
      expect(rows(client, "select scene_id, npc_id, pos from scene_npcs")).toEqual([
        { scene_id: "ankunft", npc_id: "jorna", pos: 0 },
      ]);
      expect(rows(client, "select scene_id, tag, pos from scene_tags")).toEqual([
        { scene_id: "ankunft", tag: "social", pos: 0 },
      ]);
      expect(rows(client, "select session_id, scene_id, pos from log_entries")).toEqual([
        { session_id: "s1", scene_id: "ankunft", pos: 0 },
      ]);
      expect(rows(client, "select session_id, scene_id, pos from session_scenes_played")).toEqual([
        { session_id: "s1", scene_id: "ankunft", pos: 0 },
      ]);
      // …and the rebuilt rows themselves, values and `rev` untouched.
      expect(rows(client, "select id, chapter_id, location, type, status, rev from scenes")).toEqual(
        [
          {
            id: "ankunft",
            chapter_id: "01",
            location: "hafen",
            type: "contingency",
            status: "ready",
            rev: 1,
          },
        ],
      );
      expect(rows(client, "select id, status, rev from npcs")).toEqual([
        { id: "jorna", status: "alive", rev: 1 },
      ]);
      expect(rows(client, "select id, status, rev from chapters")).toEqual([
        { id: "01", status: "active", rev: 1 },
      ]);
      expect(rows(client, "select id, chapter_id from locations")).toEqual([
        { id: "hafen", chapter_id: "01" },
      ]);
    } finally {
      client.close();
    }
  });

  test("the rebuilt tables keep their foreign keys and gain the checks", async () => {
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
      apply(client, SUBJECT);

      // A rebuild that loses a foreign key is the failure mode this guards:
      // the constraints of ADR #19 are still there afterwards.
      // One PRAGMA row per foreign-key COLUMN, so a composite key shows up
      // once per column — the set of targets is what this is about.
      const targets = (table: string): string[] => [
        ...new Set(rows(client, `pragma foreign_key_list(${table})`).map((row) => String(row.table))),
      ].sort();
      expect(targets("scenes")).toEqual(["campaigns", "chapters", "locations"]);
      expect(targets("npcs")).toEqual(["campaigns", "chapters"]);
      expect(targets("chapters")).toEqual(["campaigns"]);

      expect(definitionOf(client, "scenes")).toContain("scenes_status_check");
      expect(definitionOf(client, "scenes")).toContain("scenes_type_check");
      expect(definitionOf(client, "npcs")).toContain("npcs_status_check");
      expect(definitionOf(client, "chapters")).toContain("chapters_status_check");
    } finally {
      client.close();
    }
  });

  test("afterwards the column itself refuses a foreign value", async () => {
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
      apply(client, SUBJECT);

      expect(() =>
        client.exec("update scenes set status = 'halbfertig' where id = 'ankunft'"),
      ).toThrow();
      expect(() => client.exec("update npcs set status = 'tot' where id = 'jorna'")).toThrow();
      expect(() => client.exec("update scenes set type = 'optional' where id = 'ankunft'")).toThrow();
      // A chapter may hold NOTHING — that is how it loses its status.
      client.exec("update chapters set status = null where id = '01'");
      expect(rows(client, "select status from chapters")).toEqual([{ status: null }]);
    } finally {
      client.close();
    }
  });

  test("the fixture campaign carries the constraints after a normal boot", async () => {
    // The whole suite seeds through the real loader; this is the one case that
    // looks at what the boot left in `sqlite_master` for it.
    const db = await seedStore();
    try {
      const found = db.all<{ sql: string }>(
        sql`select sql from sqlite_master where type = 'table' and name = 'scenes'`,
      );
      expect(found[0]?.sql).toContain("scenes_status_check");
      const scenes = db.all<{ n: number }>(sql`select count(*) as n from scenes`);
      expect(Number(scenes[0]?.n ?? 0)).toBeGreaterThan(0);
    } finally {
      dropStore();
    }
  });
});

describe("the pre-flight in front of the constraints", () => {
  test("clean data has nothing to report and migrates", async () => {
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
      expect(findStatusProblems(client)).toEqual([]);
      expect(() => assertStatusesReady(client)).not.toThrow();
      apply(client, SUBJECT);
      // …and afterwards there is nothing left to check.
      expect(findStatusProblems(client)).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("a planted foreign value refuses the start, naming campaign and address", async () => {
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
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
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
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
    const client = await preCheckDb();
    try {
      seedCampaignRows(client);
      client.exec("update chapters set status = null where id = '01'");
      expect(findStatusProblems(client)).toEqual([]);
    } finally {
      client.close();
    }
  });
});
