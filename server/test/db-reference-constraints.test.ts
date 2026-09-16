// The database half of referential integrity: the constraints themselves and
// the migration that adds them (0014).
//
// Three subjects, and they are separate on purpose:
//
//   1. THE CONSTRAINTS, asked of a migrated database through SQL: an insert
//      that names nothing is refused, a scene without a chapter is refused,
//      and a renamed id drags its references along.
//   2. THE REBUILD. SQLite cannot add a constraint to an existing table, so
//      the migration rebuilds seven tables — and the migrator runs inside a
//      transaction, where `PRAGMA foreign_keys` is ignored. Dropping the old
//      `scenes` therefore deletes every `scene_npcs` and `scene_tags` row
//      through their cascade. The migration sets those rows aside first;
//      these cases are what says so, and they fail if it stops doing it.
//   3. THE PRE-FLIGHT that runs before all of it: data that cannot satisfy
//      the constraints aborts the start, with the offending values in the
//      report and nothing migrated.
//
// The old-schema database is built BY HAND, like the other pre-migration
// step's test next to this one: that is what keeps the case honest about
// running against a schema the current one no longer has.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { MIGRATIONS_DIR, openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";
import {
  assertReferencesResolvable,
  findReferenceProblems,
  referenceProblemReport,
} from "../src/db/reference-preflight";

// --- the constraints on a migrated database ---------------------------------

/** A migrated database with one campaign, one chapter, one location, one npc. */
async function migratedDb() {
  const opened = await openDb(":memory:");
  const { db } = opened;
  db.run(sql`insert into campaigns (id, name) values ('beispiel', 'Beispiel')`);
  db.run(sql`insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Kapitel', 0)`);
  db.run(sql`insert into locations (campaign_id, id, name) values ('beispiel', 'hafen', 'Hafen')`);
  db.run(sql`insert into npcs (campaign_id, id, name) values ('beispiel', 'jorna', 'Jorna')`);
  db.run(
    sql`insert into scenes (campaign_id, id, chapter_id, location, title, pos) values ('beispiel', 'ankunft', '01', 'hafen', 'Ankunft', 0)`,
  );
  db.run(sql`insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30')`);
  return opened;
}

describe("the reference constraints", () => {
  test("a reference that names nothing is refused, one column at a time", async () => {
    // On the RAW client, so the assertion reads SQLite's own message.
    const { client, close } = await migratedDb();
    try {
      const refused: Array<[string, string]> = [
        [
          "scenes.chapter_id",
          "insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'x', '99', 'X', 1)",
        ],
        [
          "scenes.location",
          "insert into scenes (campaign_id, id, chapter_id, location, title, pos) values ('beispiel', 'x', '01', 'nirgendwo', 'X', 1)",
        ],
        [
          "scene_npcs.npc_id",
          "insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'ankunft', 'niemand', 0)",
        ],
        [
          "npcs.chapter_id",
          "insert into npcs (campaign_id, id, name, chapter_id) values ('beispiel', 'holm', 'Holm', '99')",
        ],
        [
          "locations.chapter_id",
          "insert into locations (campaign_id, id, name, chapter_id) values ('beispiel', 'mole', 'Mole', '99')",
        ],
        [
          "log_entries.scene_id",
          "insert into log_entries (campaign_id, session_id, pos, raw, scene_id) values ('beispiel', 's1', 0, '- 19:00 (x) y', 'x')",
        ],
        [
          "session_scenes_played.scene_id",
          "insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'x', 0)",
        ],
      ];
      for (const [column, statement] of refused) {
        expect(() => client.prepare(statement).run(), column).toThrow(
          /FOREIGN KEY constraint failed/,
        );
      }
    } finally {
      close();
    }
  });

  test("a scene without a chapter is refused", async () => {
    const { client, close } = await migratedDb();
    try {
      expect(() =>
        client
          .prepare(
            "insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'x', null, 'X', 1)",
          )
          .run(),
      ).toThrow(/NOT NULL constraint failed/);
    } finally {
      close();
    }
  });

  test("a reference that names an entry is stored", async () => {
    const { db, close } = await migratedDb();
    try {
      db.run(
        sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'ankunft', 'jorna', 0)`,
      );
      db.run(
        sql`insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'ankunft', 0)`,
      );
      expect(db.all(sql`select 1 from scene_npcs`).length).toBe(1);
    } finally {
      close();
    }
  });

  test("an id update drags every reference along", async () => {
    const { db, close } = await migratedDb();
    try {
      db.run(
        sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'ankunft', 'jorna', 0)`,
      );
      db.run(
        sql`insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'ankunft', 0)`,
      );
      db.run(sql`update npcs set id = 'hafenmeisterin' where campaign_id = 'beispiel' and id = 'jorna'`);
      db.run(sql`update locations set id = 'alter-hafen' where campaign_id = 'beispiel' and id = 'hafen'`);
      db.run(sql`update chapters set id = '01-neu' where campaign_id = 'beispiel' and id = '01'`);
      db.run(sql`update scenes set id = 'ankunft-neu' where campaign_id = 'beispiel' and id = 'ankunft'`);

      expect(db.all<{ npc_id: string }>(sql`select npc_id from scene_npcs`)).toEqual([
        { npc_id: "hafenmeisterin" },
      ]);
      expect(
        db.all<{ chapter_id: string; location: string }>(
          sql`select chapter_id, location from scenes`,
        ),
      ).toEqual([{ chapter_id: "01-neu", location: "alter-hafen" }]);
      expect(db.all<{ scene_id: string }>(sql`select scene_id from session_scenes_played`)).toEqual(
        [{ scene_id: "ankunft-neu" }],
      );
    } finally {
      close();
    }
  });
});

// --- the rebuild ------------------------------------------------------------

/** The schema as it stood before the constraints, for the tables they touch. */
async function preConstraintDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(`
    create table campaigns (id text primary key, name text not null default '');
    create table chapters (
      campaign_id text not null, id text not null, title text not null default '',
      status text, body text not null default '', extra text not null default '{}',
      pos integer not null default 0, rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table locations (
      campaign_id text not null, id text not null, name text not null default '',
      chapter_id text, roll20_page text, body text not null default '',
      extra text not null default '{}', rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table npcs (
      campaign_id text not null, id text not null, name text not null default '',
      role text, chapter_id text, status text not null default 'unknown', statblock text,
      quickstats text not null default '{}', voice text, appearance text,
      body text not null default '', extra text not null default '{}',
      rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table npc_relations (
      campaign_id text not null, npc_id text not null, other_npc_id text not null,
      note text not null default '', pos integer not null,
      primary key (campaign_id, npc_id, other_npc_id),
      foreign key (campaign_id, npc_id) references npcs(campaign_id, id)
        on update cascade on delete cascade
    );
    create table scenes (
      campaign_id text not null, id text not null, chapter_id text,
      title text not null default '', type text not null default 'planned', trigger text,
      location text, status text not null default 'draft', handouts text not null default '[]',
      body text not null default '', extra text not null default '{}',
      pos integer not null default 0, rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table scene_npcs (
      campaign_id text not null, scene_id text not null, npc_id text not null,
      pos integer not null,
      primary key (campaign_id, scene_id, npc_id),
      foreign key (campaign_id, scene_id) references scenes(campaign_id, id)
        on update cascade on delete cascade
    );
    create table scene_tags (
      campaign_id text not null, scene_id text not null, tag text not null,
      pos integer not null,
      primary key (campaign_id, scene_id, tag),
      foreign key (campaign_id, scene_id) references scenes(campaign_id, id)
        on update cascade on delete cascade
    );
    create table sessions (
      campaign_id text not null, id text not null, started text, ended text,
      body text not null default '', extra text not null default '{}',
      rev integer not null default 1, created_at integer not null default 0,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table log_entries (
      campaign_id text not null, session_id text not null, pos integer not null,
      raw text not null, at text, scene_id text, text text,
      hash text not null default '', reviewed integer not null default 0,
      primary key (campaign_id, session_id, pos),
      foreign key (campaign_id, session_id) references sessions(campaign_id, id)
        on update cascade on delete cascade
    );
    create table session_scenes_played (
      campaign_id text not null, session_id text not null, scene_id text not null,
      pos integer not null,
      primary key (campaign_id, session_id, pos),
      foreign key (campaign_id, session_id) references sessions(campaign_id, id)
        on update cascade on delete cascade
    );
  `);
  return client;
}

/** One campaign whose references all resolve — the case that migrates. */
function seedResolvable(client: SqliteClient): void {
  client.exec(`
    insert into campaigns (id, name) values ('beispiel', 'Beispiel');
    insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Kapitel', 0);
    insert into locations (campaign_id, id, name, chapter_id) values ('beispiel', 'hafen', 'Hafen', '01');
    insert into npcs (campaign_id, id, name, chapter_id) values ('beispiel', 'jorna', 'Jorna', '01');
    insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos)
      values ('beispiel', 'jorna', 'fenn', 'kennt ihn', 0);
    insert into scenes (campaign_id, id, chapter_id, location, title, pos)
      values ('beispiel', 'ankunft', '01', 'hafen', 'Ankunft', 0);
    insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'ankunft', 'jorna', 0);
    insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'ankunft', 'social', 0);
    insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30');
    insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text, hash)
      values ('beispiel', 's1', 0, '- 19:52 (ankunft) Spuren', '19:52', 'ankunft', 'Spuren', 'abc');
    insert into session_scenes_played (campaign_id, session_id, scene_id, pos)
      values ('beispiel', 's1', 'ankunft', 0);
  `);
}

/** Run the committed migration exactly as the migrator does: one transaction. */
function applyConstraintMigration(client: SqliteClient): void {
  const file = path.join(MIGRATIONS_DIR, "0014_reference_constraints.sql");
  const statements = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  client.transaction(() => {
    for (const statement of statements) client.exec(statement);
  }).immediate();
}

function rows(client: SqliteClient, query: string): Record<string, unknown>[] {
  return client.prepare(query).all();
}

describe("the rebuild keeps every row", () => {
  test("the child rows of a rebuilt table survive the migration", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      applyConstraintMigration(client);

      // The rows whose tables were dropped and rebuilt around them.
      expect(rows(client, "select scene_id, npc_id, pos from scene_npcs")).toEqual([
        { scene_id: "ankunft", npc_id: "jorna", pos: 0 },
      ]);
      expect(rows(client, "select scene_id, tag, pos from scene_tags")).toEqual([
        { scene_id: "ankunft", tag: "social", pos: 0 },
      ]);
      expect(rows(client, "select pos, raw, at, scene_id, text, hash from log_entries")).toEqual([
        {
          pos: 0,
          raw: "- 19:52 (ankunft) Spuren",
          at: "19:52",
          scene_id: "ankunft",
          text: "Spuren",
          hash: "abc",
        },
      ]);
      expect(rows(client, "select session_id, scene_id, pos from session_scenes_played")).toEqual([
        { session_id: "s1", scene_id: "ankunft", pos: 0 },
      ]);
      // …and the parents, with their values.
      expect(rows(client, "select id, chapter_id, location, title, pos from scenes")).toEqual([
        { id: "ankunft", chapter_id: "01", location: "hafen", title: "Ankunft", pos: 0 },
      ]);
      expect(rows(client, "select id, name, chapter_id from npcs")).toEqual([
        { id: "jorna", name: "Jorna", chapter_id: "01" },
      ]);
      expect(rows(client, "select id, name, chapter_id from locations")).toEqual([
        { id: "hafen", name: "Hafen", chapter_id: "01" },
      ]);
    } finally {
      client.close();
    }
  });

  test("the constraints are in place afterwards, and nothing is left over", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      applyConstraintMigration(client);

      const fks = rows(client, "pragma foreign_key_list(scenes)").map((row) => row.table);
      expect(new Set(fks)).toEqual(new Set(["campaigns", "chapters", "locations"]));
      expect(() =>
        client
          .prepare(
            "insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'x', '99', 'X', 1)",
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      // The relations table is gone, and so are the migration's own tables.
      const tables = rows(
        client,
        "select name from sqlite_master where type = 'table' order by name",
      ).map((row) => row.name as string);
      expect(tables).not.toContain("npc_relations");
      expect(tables.filter((name) => name.startsWith("__"))).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("dropping a rebuilt parent inside a transaction takes its child rows", async () => {
    // The reason the migration puts the rows aside: `PRAGMA foreign_keys` is
    // ignored inside a transaction, so the implicit delete of a DROP TABLE
    // fires the children's cascade. Without the backup tables the two cases
    // above would come back empty.
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      client.transaction(() => {
        client.exec("PRAGMA foreign_keys = OFF");
        client.exec("DROP TABLE scenes");
      }).immediate();
      expect(rows(client, "select scene_id from scene_npcs")).toEqual([]);
      expect(rows(client, "select scene_id from scene_tags")).toEqual([]);
    } finally {
      client.close();
    }
  });
});

// --- the pre-flight ---------------------------------------------------------

describe("the pre-flight in front of the constraints", () => {
  test("a database whose references resolve has nothing to report", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      expect(findReferenceProblems(client)).toEqual([]);
      expect(() => assertReferencesResolvable(client)).not.toThrow();
    } finally {
      client.close();
    }
  });

  test("a migrated database is not asked again", async () => {
    const { client, close } = await openDb(":memory:");
    try {
      expect(findReferenceProblems(client)).toEqual([]);
    } finally {
      close();
    }
  });

  test("every unresolvable reference is named with its values and its count", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      // One of each: a scene with no chapter, a chapter that does not exist,
      // a location, an npc in a list, a played scene and a log marker.
      client.exec(`
        insert into scenes (campaign_id, id, chapter_id, location, title, pos)
          values ('beispiel', 'ohne-kapitel', null, null, 'Ohne', 1);
        insert into scenes (campaign_id, id, chapter_id, location, title, pos)
          values ('beispiel', 'fremd', '99-weg', 'nirgendwo', 'Fremd', 2);
        insert into scene_npcs (campaign_id, scene_id, npc_id, pos)
          values ('beispiel', 'ankunft', 'alte-fischerin', 1);
        insert into npcs (campaign_id, id, name, chapter_id)
          values ('beispiel', 'holm', 'Holm', '99-weg');
        insert into locations (campaign_id, id, name, chapter_id)
          values ('beispiel', 'mole', 'Mole', '99-weg');
        insert into log_entries (campaign_id, session_id, pos, raw, scene_id)
          values ('beispiel', 's1', 1, '- 20:00 (weg) x', 'weg');
        insert into session_scenes_played (campaign_id, session_id, scene_id, pos)
          values ('beispiel', 's1', 'weg', 1);
      `);

      const problems = findReferenceProblems(client);
      const at = (table: string, column: string) =>
        problems.find((p) => p.table === table && p.column === column && p.target !== "");
      expect(at("scenes", "chapter_id")).toMatchObject({
        target: "chapters",
        rows: 1,
        values: ["beispiel/99-weg"],
      });
      expect(at("scenes", "location")).toMatchObject({
        target: "locations",
        values: ["beispiel/nirgendwo"],
      });
      expect(at("scene_npcs", "npc_id")).toMatchObject({
        target: "npcs",
        values: ["beispiel/alte-fischerin"],
      });
      expect(at("npcs", "chapter_id")).toMatchObject({ target: "chapters", rows: 1 });
      expect(at("locations", "chapter_id")).toMatchObject({ target: "chapters", rows: 1 });
      expect(at("log_entries", "scene_id")).toMatchObject({
        target: "scenes",
        values: ["beispiel/weg"],
      });
      expect(at("session_scenes_played", "scene_id")).toMatchObject({
        target: "scenes",
        values: ["beispiel/weg"],
      });
      // The scene that names no chapter at all is its own line.
      expect(problems).toContainEqual({
        table: "scenes",
        column: "chapter_id",
        target: "",
        rows: 1,
        values: [],
      });

      // The report says where the data is wrong and what has to happen.
      const report = referenceProblemReport(problems).join("\n");
      expect(report).toContain("scenes.location -> locations");
      expect(report).toContain("beispiel/nirgendwo");
      expect(report).toContain("1 entry names something that does not exist");
      expect(report).toContain("1 entry names nothing at all, and the reference is mandatory");
      expect(report).toContain("Correct this data in the previous version of the app");
      expect(report).toContain("Nothing has been migrated.");

      // And the start is aborted.
      expect(() => assertReferencesResolvable(client)).toThrow(/Reference check failed/);
    } finally {
      client.close();
    }
  });

  test("many offending values are listed up to a cap and then counted", () => {
    const values = Array.from({ length: 25 }, (_, i) => `beispiel/weg-${String(i).padStart(2, "0")}`);
    const report = referenceProblemReport([
      { table: "scenes", column: "location", target: "locations", rows: 25, values },
    ]).join("\n");
    expect(report).toContain("beispiel/weg-00");
    expect(report).toContain("and 5 more");
    expect(report).not.toContain("beispiel/weg-24");
  });
});
