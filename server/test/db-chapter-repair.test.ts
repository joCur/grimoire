// The one-time repair: a `scenes.chapter_id` without a chapters
// row gets one — and afterwards the database itself refuses such a row.
//
// Two halves, tested the way they run:
//
//   * the repair on the RAW client against a legacy database (no foreign
//     key, orphans allowed), because that is the only state it ever sees —
//     `openDb` calls it before the migrator for exactly that reason;
//   * the foreign key of migration 0014 on a fully migrated database, at SQL
//     level, because that is the promise "no scene without a chapter row" is
//     made of now.

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { NO_CHAPTER_REPAIR, repairOrphanChapters } from "../src/db/chapter-repair";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIGRATIONS_DIR, openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";

/** The legacy shape: `chapter_id` carries no foreign key at all. */
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

/**
 * The committed journal, in order. `when` is what the migrator stores as
 * `created_at`, so it is also how a database is told which migrations it has
 * already been through.
 *
 * Everything below addresses migrations by TAG and looks the index up here,
 * never by comparing tag strings: the numbers shift whenever a migration
 * lands on main ahead of this one, and a test that silently applies a
 * different set is worse than one that fails to compile.
 */
function journalEntries(): Array<{ tag: string; when: number }> {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries.map((entry) => ({ tag: entry.tag, when: entry.when }));
}

/** One migration's journal entry; throws when the tag is gone. */
function journalEntry(tag: string): { tag: string; when: number } {
  const entry = journalEntries().find((candidate) => candidate.tag === tag);
  if (entry === undefined) throw new Error(`no migration ${tag} in the journal`);
  return entry;
}

/** Position of one migration in the journal; throws when the tag is gone. */
function journalIndex(tag: string): number {
  const idx = journalEntries().findIndex((entry) => entry.tag === tag);
  if (idx < 0) throw new Error(`no migration ${tag} in the journal`);
  return idx;
}

/** Apply every committed migration up to AND INCLUDING `tag`, in order. */
function applyMigrationsThrough(client: SqliteClient, tag: string): void {
  const entries = journalEntries();
  for (const entry of entries.slice(0, journalIndex(tag) + 1)) {
    applyMigration(client, entry.tag);
  }
}

/**
 * The migrations this suite addresses by name. `DROP_CHAPTER_DECLARED` is the
 * one that took `scenes.chapter_declared` away, so it is the boundary the
 * rebuild's column list has to agree with; `CHAPTER_FK` is the rebuild
 * itself, and `BEFORE_CHAPTER_FK` the state a database is in when it reaches
 * it. `DROP_IMPORT_BOOKKEEPING` took the two import tables away and is the
 * newest state a production database can already be in.
 */
const PIPELINE_PARTS = "0010_pipeline_parts";
const DROP_CHAPTER_DECLARED = "0011_drop_chapter_declared";
const DROP_IMPORT_BOOKKEEPING = "0012_drop_import_bookkeeping";
const BEFORE_CHAPTER_FK = "0013_job_new_chapter_title";
const CHAPTER_FK = "0014_scenes_chapter_fk";

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

describe("the boot repair of orphan chapters", () => {
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

  // A BLANK `chapter_id` (review finding 1): it names no chapter, so the
  // create half has nothing to do — and it is not NULL either, so migration
  // 0013's composite foreign key would demand a chapters row with the empty id
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
  // exactly the row migration 0014 fails on.
  test("migration 0014 goes through after the repair and fails without it", async () => {
    async function upToChapterFk(): Promise<SqliteClient> {
      const client = await openSqlite(":memory:");
      client.exec("PRAGMA foreign_keys = ON");
      applyMigrationsThrough(client, BEFORE_CHAPTER_FK);
      client.prepare("insert into campaigns (id, name) values ('beispiel', 'Beispiel')").run();
      client
        .prepare("insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'szene', '', 'Szene', 0)")
        .run();
      return client;
    }

    const unrepaired = await upToChapterFk();
    expect(() =>
      unrepaired.transaction(() => applyMigration(unrepaired, CHAPTER_FK)).immediate(),
    ).toThrow();
    unrepaired.close();

    const repaired = await upToChapterFk();
    expect(repairOrphanChapters(repaired).blanked).toEqual([
      { campaignId: "beispiel", scenes: 1 },
    ]);
    repaired.transaction(() => applyMigration(repaired, CHAPTER_FK)).immediate();
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

describe("the chapter foreign key of migration 0014", () => {
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
    // The hand-edited half of migration 0014 (see its header): the migrator
    // runs every file in ONE transaction, where `PRAGMA foreign_keys=OFF` is
    // a no-op — so a plain `DROP TABLE scenes` would cascade through
    // `scene_npcs`/`scene_tags` and delete every scene's references. The
    // migration sets those rows aside and puts them back, and this is the
    // test that would catch it going back to the generated version: the
    // every migration before it by hand, real child rows in, then the
    // rebuild the way the migrator applies it.
    const client = await openSqlite(":memory:");
    client.exec("PRAGMA foreign_keys = ON");
    applyMigrationsThrough(client, BEFORE_CHAPTER_FK);

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

    client.transaction(() => applyMigration(client, CHAPTER_FK)).immediate();

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

// The upgrade itself, on the production path: a database that stopped at an
// EARLIER migration is opened by `openDb`, which runs the chapter repair on
// the raw client and then lets the real migrator carry it the rest of the
// way. Two starting points matter, because they differ in the very column
// the rebuild copies:
//
//   * 0010 — `scenes.chapter_declared` is still there. The database has to
//     go through the drop AND the rebuild in one boot.
//   * 0011 — the column is already gone. This is the state a database that
//     followed main is in, and the rebuild's explicit column list has to
//     match it exactly or the copy fails on an unknown column.
//
// Both assert on ROWS, not just on "it did not throw": the rebuild drops and
// recreates `scenes`, and the whole point of its hand-edited half is that
// nothing is lost while it does.
describe("upgrading an existing database through the chapter foreign key", () => {
  /**
   * A real file, migrated by hand up to `tag` and told so the way the
   * migrator records it: `created_at` is the journal's `when`, which is what
   * the dialect compares against to decide what is still outstanding.
   */
  async function dbStoppedAt(
    dir: string,
    tag: string,
    seed: (client: SqliteClient) => void,
  ): Promise<string> {
    const file = path.join(dir, `${tag}.db`);
    const client = await openSqlite(file);
    client.exec("PRAGMA foreign_keys = ON");
    applyMigrationsThrough(client, tag);
    seed(client);
    client.exec(
      `create table if not exists __drizzle_migrations (
         id serial primary key,
         hash text not null,
         created_at numeric
       )`,
    );
    client
      .prepare(`insert into __drizzle_migrations ("hash", "created_at") values (?, ?)`)
      .run(`seeded-${tag}`, journalEntry(tag).when);
    client.close();
    return file;
  }

  /** A scene with a chapter, a tag, an npc reference — and one orphan. */
  function seedCampaign(client: SqliteClient): void {
    client.prepare("insert into campaigns (id, name) values ('beispiel', 'Beispiel')").run();
    client
      .prepare("insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01-salzhafen', 'Salzhafen', 0)")
      .run();
    client
      .prepare("insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'szene', '01-salzhafen', 'Szene', 0)")
      .run();
    // The production case the repair exists for: a chapter nobody created.
    client
      .prepare("insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'waise', '03-dragon-hatchery', 'Waise', 1)")
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
  }

  /** What every one of these boots has to end up with. */
  async function expectUpgraded(file: string): Promise<void> {
    const { db, chapterRepair, close } = await openDb(file);
    try {
      // The repair ran, and reported the chapter it had to invent.
      expect(chapterRepair.created).toEqual([
        { campaignId: "beispiel", chapterId: "03-dragon-hatchery", scenes: 1 },
      ]);
      // Every scene survived the rebuild, chapter reference intact.
      expect(db.all(sql`select id, chapter_id from scenes order by id`)).toEqual([
        { id: "szene", chapter_id: "01-salzhafen" },
        { id: "waise", chapter_id: "03-dragon-hatchery" },
      ]);
      // …and so did the child rows the rebuild sets aside by hand.
      expect(db.all(sql`select scene_id, tag from scene_tags`)).toEqual([
        { scene_id: "szene", tag: "social" },
      ]);
      expect(db.all(sql`select scene_id, npc_id from scene_npcs`)).toEqual([
        { scene_id: "szene", npc_id: "jorna" },
      ]);
      // The dropped column is gone and the new one is there.
      const columns = (db.all(sql`select name from pragma_table_info('scenes')`) as Array<{
        name: string;
      }>).map((row) => row.name);
      expect(columns).not.toContain("chapter_declared");
      expect(columns).toContain("chapter_id");
      expect(
        (db.all(sql`select name from pragma_table_info('generate_jobs')`) as Array<{
          name: string;
        }>).map((row) => row.name),
      ).toContain("new_chapter_title");
      // Whatever the starting point was, the two import bookkeeping tables
      // main dropped are gone afterwards — the rebuild does not bring them
      // back and the boot does not miss them.
      const tables = (db.all(sql`select name from sqlite_master where type = 'table'`) as Array<{
        name: string;
      }>).map((row) => row.name);
      expect(tables).not.toContain("unknown_files");
      expect(tables).not.toContain("migration_report");
      // The foreign key the whole slice is for is enforcing now.
      expect(() =>
        db.run(
          sql`insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'neu', '99-nichts', 'Neu', 2)`,
        ),
      ).toThrow();
      // A second boot is a no-op: nothing left to repair, nothing outstanding.
      const again = await openDb(file);
      expect(again.chapterRepair).toBe(NO_CHAPTER_REPAIR);
      expect(again.db.all(sql`select id from scenes order by id`)).toEqual([
        { id: "szene" },
        { id: "waise" },
      ]);
      again.close();
    } finally {
      close();
    }
  }

  test("a database at 0010 goes through the drop and the rebuild in one boot", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0010-"));
    try {
      // The starting point has to be the OLD shape, or the test proves nothing.
      const before = await openSqlite(path.join(dir, "probe.db"));
      applyMigrationsThrough(before, PIPELINE_PARTS);
      expect(
        (before.prepare("select name from pragma_table_info('scenes')").all() as Array<{
          name: string;
        }>).map((row) => row.name),
      ).toContain("chapter_declared");
      before.close();

      await expectUpgraded(await dbStoppedAt(dir, PIPELINE_PARTS, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database at 0011 already has the column dropped and takes the rebuild", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0011-"));
    try {
      await expectUpgraded(await dbStoppedAt(dir, DROP_CHAPTER_DECLARED, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database at 0012 has lost the import tables and still takes the rebuild", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0012-"));
    try {
      // The state this starting point is about: the two import bookkeeping
      // tables are already gone, so the boot has nothing but the rebuild left
      // to do and must not stumble over their absence.
      const before = await openSqlite(path.join(dir, "probe.db"));
      applyMigrationsThrough(before, DROP_IMPORT_BOOKKEEPING);
      expect(
        (before.prepare("select name from sqlite_master where type = 'table'").all() as Array<{
          name: string;
        }>).map((row) => row.name),
      ).not.toContain("unknown_files");
      before.close();

      await expectUpgraded(await dbStoppedAt(dir, DROP_IMPORT_BOOKKEEPING, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
