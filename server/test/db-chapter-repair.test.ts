// The one-time repair of issue #115: a `scenes.chapter_id` without a chapters
// row gets one — and afterwards the database itself refuses such a row.
//
// Two halves, tested the way they run:
//
//   * the repair on the RAW client against a pre-#115 database (no foreign
//     key, orphans allowed), because that is the only state it ever sees —
//     `openDb` calls it before the migrator for exactly that reason;
//   * the foreign key of migration 0012 on a fully migrated database, at SQL
//     level, because that is the promise "no scene without a chapter row" is
//     made of now.

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { NO_CHAPTER_REPAIR, repairOrphanChapters } from "../src/db/chapter-repair";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS_DIR, openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";

/** The pre-#115 shape: `chapter_id` carries no foreign key at all. */
async function oldSchemaDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec(`
    create table chapters (
      campaign_id text not null,
      id text not null,
      title text not null default '',
      status text,
      body text not null default '',
      extra text not null default '{}',
      pos integer not null default 0,
      rev integer not null default 1,
      primary key (campaign_id, id)
    );
    create table scenes (
      campaign_id text not null,
      id text not null,
      chapter_id text,
      primary key (campaign_id, id)
    );
    create virtual table search_fts using fts5(
      title, ref, tags, body, campaign_id unindexed, kind unindexed, entity_id unindexed
    );
  `);
  return client;
}

/** Migration tags in order, read from the committed journal. */
function journalTags(): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  return journal.entries.map((entry) => entry.tag);
}

/** Apply one committed migration file the way drizzle's migrator does. */
function applyMigration(client: SqliteClient, tag: string): void {
  const sqlText = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (statement.trim() === "") continue;
    client.exec(statement);
  }
}

function addScene(client: SqliteClient, id: string, chapter: string | null): void {
  client
    .prepare("insert into scenes (campaign_id, id, chapter_id) values ('beispiel', ?, ?)")
    .run(id, chapter);
}

function chapters(client: SqliteClient): Record<string, unknown>[] {
  return client.prepare("select id, title, status, pos from chapters order by id").all();
}

describe("the boot repair of orphan chapters (#115)", () => {
  test("creates one row per named chapter, titled by its id, and reports it", async () => {
    const client = await oldSchemaDb();
    client
      .prepare("insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01-salzhafen', 'Salzhafen', 0)")
      .run();
    // The production case: twelve scenes under a chapter nobody created.
    addScene(client, "szene-a", "03-dragon-hatchery");
    addScene(client, "szene-b", "03-dragon-hatchery");
    addScene(client, "szene-c", "01-salzhafen");
    // A scene with NO chapter is legal and must be left alone.
    addScene(client, "szene-d", null);

    const outcome = repairOrphanChapters(client);

    expect(outcome.created).toEqual([
      { campaignId: "beispiel", chapterId: "03-dragon-hatchery", scenes: 2 },
    ]);
    expect(chapters(client)).toEqual([
      { id: "01-salzhafen", title: "Salzhafen", status: null, pos: 0 },
      // Named by its id — the only name anybody has for it — and last in
      // the campaign, which is where an unplaced chapter belongs.
      { id: "03-dragon-hatchery", title: "03-dragon-hatchery", status: "planned", pos: 1 },
    ]);
    // Searchable, like every other chapter: the repaired one must be
    // findable in ⌘K or the DM cannot get to it to rename it.
    expect(
      client
        .prepare("select entity_id from search_fts where kind = 'chapter'")
        .all(),
    ).toEqual([{ entity_id: "03-dragon-hatchery" }]);
    client.close();
  });

  test("is a no-op on a database without a hole, and idempotent", async () => {
    const client = await oldSchemaDb();
    client
      .prepare("insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Eins', 0)")
      .run();
    addScene(client, "szene-a", "01");
    expect(repairOrphanChapters(client)).toBe(NO_CHAPTER_REPAIR);

    addScene(client, "szene-b", "02");
    expect(repairOrphanChapters(client).created.length).toBe(1);
    // A second pass finds nothing left — the first one closed the hole.
    expect(repairOrphanChapters(client)).toBe(NO_CHAPTER_REPAIR);
    client.close();
  });

  // A BLANK `chapter_id` (#115 review, finding 1): it names no chapter, so the
  // create half has nothing to do — and it is not NULL either, so migration
  // 0012's composite foreign key would demand a chapters row with the empty id
  // and fail the boot. It becomes NULL, which is what "no chapter" means.
  test("a blank chapter_id becomes NULL and is reported", async () => {
    const client = await oldSchemaDb();
    addScene(client, "szene-a", "");
    addScene(client, "szene-b", "   ");
    addScene(client, "szene-c", null);

    const outcome = repairOrphanChapters(client);

    expect(outcome.created).toEqual([]);
    expect(outcome.blanked).toEqual([{ campaignId: "beispiel", scenes: 2 }]);
    // No chapter was invented for the empty name.
    expect(chapters(client)).toEqual([]);
    expect(
      client.prepare("select id from scenes where chapter_id is null order by id").all(),
    ).toEqual([{ id: "szene-a" }, { id: "szene-b" }, { id: "szene-c" }]);
    // And a second pass finds nothing left.
    expect(repairOrphanChapters(client)).toBe(NO_CHAPTER_REPAIR);
    client.close();
  });

  test("blanks and orphans are closed in the same pass", async () => {
    const client = await oldSchemaDb();
    addScene(client, "szene-a", "");
    addScene(client, "szene-b", "03-dragon-hatchery");

    const outcome = repairOrphanChapters(client);

    expect(outcome.created).toEqual([
      { campaignId: "beispiel", chapterId: "03-dragon-hatchery", scenes: 1 },
    ]);
    expect(outcome.blanked).toEqual([{ campaignId: "beispiel", scenes: 1 }]);
    client.close();
  });

  // The promise the blank half exists for, end to end: the same pre-0012
  // database, once with the repair and once without. A blank left in place is
  // exactly the row migration 0012 fails on.
  test("migration 0012 goes through after the repair and fails without it", async () => {
    async function upTo0011(): Promise<SqliteClient> {
      const client = await openSqlite(":memory:");
      client.exec("PRAGMA foreign_keys = ON");
      for (const tag of journalTags().filter((t) => t < "0012")) applyMigration(client, tag);
      client.prepare("insert into campaigns (id, name) values ('beispiel', 'Beispiel')").run();
      client
        .prepare("insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'szene', '', 'Szene', 0)")
        .run();
      return client;
    }

    const unrepaired = await upTo0011();
    expect(() =>
      unrepaired.transaction(() => applyMigration(unrepaired, "0012_scenes_chapter_fk")).immediate(),
    ).toThrow();
    unrepaired.close();

    const repaired = await upTo0011();
    expect(repairOrphanChapters(repaired).blanked).toEqual([
      { campaignId: "beispiel", scenes: 1 },
    ]);
    repaired.transaction(() => applyMigration(repaired, "0012_scenes_chapter_fk")).immediate();
    expect(repaired.prepare("select id, chapter_id from scenes").all()).toEqual([
      { id: "szene", chapter_id: null },
    ]);
    repaired.close();
  });

  test("keeps two campaigns apart", async () => {
    const client = await oldSchemaDb();
    client
      .prepare("insert into chapters (campaign_id, id, title, pos) values ('andere', '01', 'Eins', 0)")
      .run();
    addScene(client, "szene-a", "01");
    const outcome = repairOrphanChapters(client);
    // `01` exists — in the OTHER campaign, which is no help at all here.
    expect(outcome.created).toEqual([
      { campaignId: "beispiel", chapterId: "01", scenes: 1 },
    ]);
    client.close();
  });
});

describe("the chapter foreign key of migration 0012 (#115)", () => {
  test("rejects a scene whose chapter has no row", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      db.run(sql`insert into campaigns (id, name) values ('beispiel', 'Beispiel')`);
      // drizzle wraps the driver error, so the CAUSE carries the constraint.
      expect(() =>
        db.run(
          sql`insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'szene', '03-dragon-hatchery', 'Szene', 0)`,
        ),
      ).toThrow();
      expect(db.all(sql`select id from scenes`)).toEqual([]);
      // NULL stays legal — a composite foreign key with a NULL column is
      // satisfied, which is what keeps a chapterless scene writable.
      db.run(
        sql`insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'frei', null, 'Szene', 0)`,
      );
      expect(db.all(sql`select id from scenes`)).toEqual([{ id: "frei" }]);
    } finally {
      close();
    }
  });

  test("cascades a chapter rename into its scenes and refuses to delete it", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      db.run(sql`insert into campaigns (id, name) values ('beispiel', 'Beispiel')`);
      db.run(sql`insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Eins', 0)`);
      db.run(
        sql`insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'szene', '01', 'Szene', 0)`,
      );

      db.run(sql`update chapters set id = '01-salzhafen' where campaign_id = 'beispiel' and id = '01'`);
      expect(db.all(sql`select chapter_id from scenes`)).toEqual([
        { chapter_id: "01-salzhafen" },
      ]);

      // NO delete cascade: dropping a chapter that still owns scenes fails
      // instead of taking them with it.
      expect(() => db.run(sql`delete from chapters where campaign_id = 'beispiel'`)).toThrow();
      expect(db.all(sql`select id from chapters`)).toEqual([{ id: "01-salzhafen" }]);
    } finally {
      close();
    }
  });

  test("the rebuild keeps the scene child rows", async () => {
    // The hand-edited half of migration 0012 (see its header): the migrator
    // runs every file in ONE transaction, where `PRAGMA foreign_keys=OFF` is
    // a no-op — so a plain `DROP TABLE scenes` would cascade through
    // `scene_npcs`/`scene_tags` and delete every scene's references. The
    // migration sets those rows aside and puts them back, and this is the
    // test that would catch it going back to the generated version: the
    // migrations up to 0011 by hand, rows in, then 0012 the way the migrator
    // applies it.
    const client = await openSqlite(":memory:");
    client.exec("PRAGMA foreign_keys = ON");
    for (const tag of journalTags().filter((t) => t < "0012")) applyMigration(client, tag);

    client.prepare("insert into campaigns (id, name) values ('beispiel', 'Beispiel')").run();
    client
      .prepare("insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Eins', 0)")
      .run();
    client
      .prepare("insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'szene', '01', 'Szene', 0)")
      .run();
    client
      .prepare("insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'szene', 'social', 0)")
      .run();
    client
      .prepare("insert into npcs (campaign_id, id, name) values ('beispiel', 'jorna', 'Jorna')")
      .run();
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)")
      .run();

    client.transaction(() => applyMigration(client, "0012_scenes_chapter_fk")).immediate();

    expect(client.prepare("select tag from scene_tags").all()).toEqual([{ tag: "social" }]);
    expect(client.prepare("select npc_id from scene_npcs").all()).toEqual([{ npc_id: "jorna" }]);
    expect(client.prepare("select id from scenes").all()).toEqual([{ id: "szene" }]);
    // …and the constraint it was all for is in place now.
    expect(() =>
      client
        .prepare("insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'waise', '99', 'Szene', 0)")
        .run(),
    ).toThrow();
    client.close();
  });
});
