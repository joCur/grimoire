// The reference constraints of ADR #18, tested in the three shapes they have:
//
//   * the REPAIR on the raw client against a legacy database (no constraints,
//     every hole legal), because that is the only state it ever sees —
//     `openDb` calls it before the migrator for exactly that reason;
//   * the FOREIGN KEYS on a fully migrated database, at SQL level, because
//     that is what the promise "a reference names a row that exists" is made
//     of now;
//   * the MIGRATION itself, applied the way the migrator applies it, because
//     its rebuilds drop and recreate five tables and nothing may be lost
//     while they do.

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  NO_REFERENCE_REPAIR,
  repairReferences,
  reportForeignKeyViolations,
  UNSORTED_CHAPTER_ID,
  UNSORTED_CHAPTER_TITLE,
} from "../src/db/reference-repair";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIGRATIONS_DIR, openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";

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

/** Apply one committed migration the way drizzle's migrator does. */
function applyMigration(client: SqliteClient, tag: string): void {
  const sqlText = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    if (statement.trim() === "") continue;
    client.exec(statement);
  }
}

/** Apply every committed migration up to AND INCLUDING `tag`, in order. */
function applyMigrationsThrough(client: SqliteClient, tag: string): void {
  for (const entry of journalEntries().slice(0, journalIndex(tag) + 1)) {
    applyMigration(client, entry.tag);
  }
}

/**
 * The migrations this suite addresses by name. `DROP_CHAPTER_DECLARED` is the
 * one that took `scenes.chapter_declared` away, so it is the boundary the
 * rebuilds' column lists have to agree with; `DROP_IMPORT_BOOKKEEPING` took
 * the two import tables away. `LEGACY` is the last state in which every
 * reference hole is still legal, and `REFERENCE_FKS` is the migration that
 * ends that.
 */
const PIPELINE_PARTS = "0010_pipeline_parts";
const DROP_CHAPTER_DECLARED = "0011_drop_chapter_declared";
const DROP_IMPORT_BOOKKEEPING = "0012_drop_import_bookkeeping";
const LEGACY = "0013_job_new_chapter_title";
const CHAPTER_FK = "0014_scenes_chapter_fk";
const REFERENCE_FKS = "0015_reference_foreign_keys";

/**
 * A database in the LEGACY shape: every table of migration 0013, where a
 * reference may still point at nothing. The real shape on purpose — the
 * repair reads seven columns across six tables, and a hand-written subset
 * would only prove itself.
 */
async function legacyDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec("PRAGMA foreign_keys = ON");
  applyMigrationsThrough(client, LEGACY);
  client.prepare("insert into campaigns (id, name) values ('beispiel', 'Beispiel')").run();
  return client;
}

function addChapter(client: SqliteClient, id: string, campaign = "beispiel"): void {
  client
    .prepare("insert into chapters (campaign_id, id, title, pos) values (?, ?, ?, 0)")
    .run(campaign, id, id);
}

function addScene(
  client: SqliteClient,
  id: string,
  chapter: string | null,
  location: string | null = null,
  campaign = "beispiel",
): void {
  client
    .prepare(
      "insert into scenes (campaign_id, id, chapter_id, location, title, pos) values (?, ?, ?, ?, ?, 0)",
    )
    .run(campaign, id, chapter, location, id);
}

function addNpc(client: SqliteClient, id: string, chapter: string | null = null): void {
  client
    .prepare("insert into npcs (campaign_id, id, name, chapter_id) values ('beispiel', ?, ?, ?)")
    .run(id, id, chapter);
}

function rows(client: SqliteClient, query: string): Record<string, unknown>[] {
  return client.prepare(query).all();
}

describe("the boot repair of chapter references", () => {
  test("creates one chapter per named id, titled by its id, and reports it", async () => {
    const client = await legacyDb();
    addChapter(client, "01-salzhafen");
    // The production case: twelve scenes under a chapter nobody created.
    addScene(client, "szene-a", "03-dragon-hatchery");
    addScene(client, "szene-b", "03-dragon-hatchery");
    addScene(client, "szene-c", "01-salzhafen");

    const outcome = repairReferences(client);

    expect(outcome.chaptersCreated).toEqual([
      { campaignId: "beispiel", chapterId: "03-dragon-hatchery", scenes: 2 },
    ]);
    expect(rows(client, "select id, title, status, pos from chapters order by id")).toEqual([
      { id: "01-salzhafen", title: "01-salzhafen", status: null, pos: 0 },
      // Named by its id — the only name anybody has for it — and last in
      // the campaign, which is where an unplaced chapter belongs.
      { id: "03-dragon-hatchery", title: "03-dragon-hatchery", status: "planned", pos: 1 },
    ]);
    // Searchable, like every other chapter: the repaired one must be
    // findable in ⌘K or the DM cannot get to it to rename it.
    expect(rows(client, "select entity_id from search_fts where kind = 'chapter'")).toEqual([
      { entity_id: "03-dragon-hatchery" },
    ]);
    client.close();
  });

  // The half the NOT NULL column needs: a scene has to BELONG to a chapter,
  // so a scene that names none is given one instead of failing the boot.
  test("a scene with NO chapter is moved into the unsorted chapter", async () => {
    const client = await legacyDb();
    addScene(client, "szene-a", null);
    addScene(client, "szene-b", "");
    addScene(client, "szene-c", "   ");

    const outcome = repairReferences(client);

    expect(outcome.unsorted).toEqual([{ campaignId: "beispiel", scenes: 3, chapterCreated: true }]);
    expect(outcome.chaptersCreated).toEqual([]);
    expect(rows(client, "select id, title, status from chapters")).toEqual([
      { id: UNSORTED_CHAPTER_ID, title: UNSORTED_CHAPTER_TITLE, status: "planned" },
    ]);
    expect(rows(client, "select id, chapter_id from scenes order by id")).toEqual([
      { id: "szene-a", chapter_id: UNSORTED_CHAPTER_ID },
      { id: "szene-b", chapter_id: UNSORTED_CHAPTER_ID },
      { id: "szene-c", chapter_id: UNSORTED_CHAPTER_ID },
    ]);
    // A second pass finds nothing left.
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("the chapter of an npc and of a location is emptied, never invented", async () => {
    const client = await legacyDb();
    addChapter(client, "01-salzhafen");
    addNpc(client, "jorna", "99-nirgendwo");
    client
      .prepare("insert into locations (campaign_id, id, name, chapter_id) values ('beispiel', 'hafen', 'Hafen', '  ')")
      .run();

    const outcome = repairReferences(client);

    // Chapters are not created by naming them (ADR #14): an npc's `chapter:`
    // is a grouping note, so the note goes — not a chapter into the overview.
    expect(rows(client, "select id, chapter_id from npcs")).toEqual([
      { id: "jorna", chapter_id: null },
    ]);
    expect(rows(client, "select id, chapter_id from locations")).toEqual([
      { id: "hafen", chapter_id: null },
    ]);
    expect(outcome.chaptersCreated).toEqual([]);
    expect(outcome.cleared).toEqual([
      { campaignId: "beispiel", column: "npcs.chapter_id", rows: 1 },
      { campaignId: "beispiel", column: "locations.chapter_id", rows: 1 },
    ]);
    client.close();
  });

  test("keeps two campaigns apart", async () => {
    const client = await legacyDb();
    client.prepare("insert into campaigns (id, name) values ('andere', 'Andere')").run();
    addChapter(client, "01", "andere");
    addScene(client, "szene-a", "01");

    // `01` exists — in the OTHER campaign, which is no help at all here.
    expect(repairReferences(client).chaptersCreated).toEqual([
      { campaignId: "beispiel", chapterId: "01", scenes: 1 },
    ]);
    client.close();
  });
});

describe("the boot repair of entity references", () => {
  test("a scene's location gets its empty entry, a blank one becomes none", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene-a", "01", "bucht");
    addScene(client, "szene-b", "01", "  ");

    const outcome = repairReferences(client);

    expect(outcome.entriesCreated).toEqual([
      { campaignId: "beispiel", kind: "location", id: "bucht" },
    ]);
    expect(outcome.cleared).toEqual([
      { campaignId: "beispiel", column: "scenes.location", rows: 1 },
    ]);
    expect(rows(client, "select id, name from locations")).toEqual([{ id: "bucht", name: "" }]);
    expect(rows(client, "select id, location from scenes order by id")).toEqual([
      { id: "szene-a", location: "bucht" },
      { id: "szene-b", location: null },
    ]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("a scene's npc list and a relation counterpart get their empty entries", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01");
    addNpc(client, "jorna");
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'holm', 0)")
      .run();
    client
      .prepare("insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values ('beispiel', 'jorna', 'metta', 'alte Bekannte', 0)")
      .run();

    const outcome = repairReferences(client);

    expect(outcome.entriesCreated).toEqual([
      { campaignId: "beispiel", kind: "npc", id: "holm" },
      { campaignId: "beispiel", kind: "npc", id: "metta" },
    ]);
    // Both references are still there — the repair closes holes, it drops
    // nothing that carries information.
    expect(rows(client, "select npc_id from scene_npcs")).toEqual([{ npc_id: "holm" }]);
    expect(rows(client, "select other_npc_id, note from npc_relations")).toEqual([
      { other_npc_id: "metta", note: "alte Bekannte" },
    ]);
    expect(rows(client, "select id, name from npcs order by id")).toEqual([
      { id: "holm", name: "" },
      { id: "jorna", name: "jorna" },
      { id: "metta", name: "" },
    ]);
    client.close();
  });

  // The production case: the counterpart of a relation line was stored in the
  // body-reference spelling. The npc it names EXISTS, so the reference is
  // re-pointed at it instead of answered with an entry called `[[…]]`.
  test("a counterpart stored as `[[id]]` is re-pointed at the npc it names", async () => {
    const client = await legacyDb();
    addNpc(client, "william-the-roper");
    addNpc(client, "frulam-mondath");
    client
      .prepare("insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values ('beispiel', 'william-the-roper', '[[frulam-mondath]]', 'gleichgültig', 0)")
      .run();

    const outcome = repairReferences(client);

    expect(outcome.repointed).toEqual([
      {
        campaignId: "beispiel",
        column: "npc_relations.other_npc_id",
        from: "[[frulam-mondath]]",
        to: "frulam-mondath",
        rows: 1,
      },
    ]);
    expect(outcome.entriesCreated).toEqual([]);
    expect(rows(client, "select other_npc_id, note from npc_relations")).toEqual([
      { other_npc_id: "frulam-mondath", note: "gleichgültig" },
    ]);
    // No second entry for an npc who already has one.
    expect(rows(client, "select count(*) as n from npcs")).toEqual([{ n: 2 }]);
    client.close();
  });

  test("re-pointing drops the entry it would duplicate", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01");
    addNpc(client, "jorna");
    // The same npc twice — once wrapped, once plain. One entry has to
    // survive: a scene lists an npc once (the primary key says so).
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)")
      .run();
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', '[[jorna]]', 1)")
      .run();

    const outcome = repairReferences(client);

    expect(rows(client, "select npc_id, pos from scene_npcs")).toEqual([
      { npc_id: "jorna", pos: 0 },
    ]);
    // BOTH numbers, because they used to disagree with the rows: the delete
    // was silent, and the re-pointing counted the row it had just removed —
    // two entries in the list for one row that never moved.
    expect(outcome.dropped).toEqual([
      { campaignId: "beispiel", table: "scene_npcs", rows: 1 },
    ]);
    expect(outcome.repointed).toEqual([]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("a dedup next to a row that DOES move reports one of each", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01");
    addScene(client, "andere", "01");
    addNpc(client, "jorna");
    // `[[jorna]]` twice: in one scene it duplicates the plain spelling and
    // has to go, in the other it is the only entry and moves onto `jorna`.
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)")
      .run();
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', '[[jorna]]', 1)")
      .run();
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'andere', '[[jorna]]', 0)")
      .run();

    const outcome = repairReferences(client);

    expect(outcome.dropped).toEqual([
      { campaignId: "beispiel", table: "scene_npcs", rows: 1 },
    ]);
    expect(outcome.repointed).toEqual([
      {
        campaignId: "beispiel",
        column: "scene_npcs.npc_id",
        from: "[[jorna]]",
        to: "jorna",
        rows: 1,
      },
    ]);
    expect(rows(client, "select scene_id, npc_id from scene_npcs order by scene_id")).toEqual([
      { scene_id: "andere", npc_id: "jorna" },
      { scene_id: "szene", npc_id: "jorna" },
    ]);
    client.close();
  });

  test("a reference that names NOTHING and cannot be empty loses its row", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01");
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', '   ', 0)")
      .run();

    const outcome = repairReferences(client);

    expect(outcome.dropped).toEqual([
      { campaignId: "beispiel", table: "scene_npcs", rows: 1 },
    ]);
    expect(rows(client, "select npc_id from scene_npcs")).toEqual([]);
    // Nothing was invented for the empty name.
    expect(rows(client, "select count(*) as n from npcs")).toEqual([{ n: 0 }]);
    client.close();
  });

  test("the scene a log line and a played list name gets its entry", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    client
      .prepare("insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30')")
      .run();
    client
      .prepare("insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text) values ('beispiel', 's1', 0, '- 19:52 (hafen) los', '19:52', 'hafen', 'los')")
      .run();
    client
      .prepare("insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'leuchtturm', 0)")
      .run();

    const outcome = repairReferences(client);

    // A created scene needs the one thing a scene cannot be without, so it
    // lands in „Unsortiert" — where the DM can see it and move it.
    expect(outcome.entriesCreated).toEqual([
      { campaignId: "beispiel", kind: "scene", id: "hafen" },
      { campaignId: "beispiel", kind: "scene", id: "leuchtturm" },
    ]);
    expect(rows(client, "select id, chapter_id, title from scenes order by id")).toEqual([
      { id: "hafen", chapter_id: UNSORTED_CHAPTER_ID, title: "" },
      { id: "leuchtturm", chapter_id: UNSORTED_CHAPTER_ID, title: "" },
    ]);
    // The evening is untouched: the line keeps its scene, the list its entry.
    expect(rows(client, "select scene_id from log_entries")).toEqual([{ scene_id: "hafen" }]);
    expect(rows(client, "select scene_id from session_scenes_played")).toEqual([
      { scene_id: "leuchtturm" },
    ]);
    client.close();
  });

  // The second half of "a reference never invents an entry the DM would not
  // recognise": the brackets were notation, and PROSE is not an id either.
  // An entry whose id is a sentence would carry that sentence in every
  // address built from it and in every ⌘K result — so the text is read
  // instead: `toSlug` gives the id, the text becomes the entry's NAME. That
  // is the answer the group step gives the same column, and the two have to
  // agree or a boot would undo what that step decided.
  test("free text in a scene's location becomes an id with the text as its name", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01", "Der alte Hafen");

    const outcome = repairReferences(client);

    expect(outcome.entriesCreated).toEqual([
      {
        campaignId: "beispiel",
        kind: "location",
        id: "der-alte-hafen",
        fromText: "Der alte Hafen",
      },
    ]);
    expect(rows(client, "select id, name from locations")).toEqual([
      { id: "der-alte-hafen", name: "Der alte Hafen" },
    ]);
    expect(rows(client, "select id, location from scenes")).toEqual([
      { id: "szene", location: "der-alte-hafen" },
    ]);
    expect(outcome.repointed).toEqual([
      {
        campaignId: "beispiel",
        column: "scenes.location",
        from: "Der alte Hafen",
        to: "der-alte-hafen",
        rows: 1,
      },
    ]);
    // Nothing was lost, so nothing is in the "please set them" list.
    expect(outcome.clearedText).toEqual([]);
    // ⌘K finds the Ort by the text the DM wrote, not only by its slug.
    expect(
      rows(client, "select title from search_fts where entity_id = 'der-alte-hafen'"),
    ).toEqual([{ title: "Der alte Hafen" }]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("a location text that yields no id at all becomes none, and is reported", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01", "???");

    const outcome = repairReferences(client);

    // An id is never invented out of nothing, and the column may be empty —
    // so the scene falls back to chapter level and the text is in the report,
    // which is then the only place it still stands.
    expect(outcome.entriesCreated).toEqual([]);
    expect(rows(client, "select count(*) as n from locations")).toEqual([{ n: 0 }]);
    expect(rows(client, "select id, location from scenes")).toEqual([
      { id: "szene", location: null },
    ]);
    expect(outcome.clearedText).toEqual([
      { campaignId: "beispiel", column: "scenes.location", value: "???", rows: 1 },
    ]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  // The one reference that is read the other way round: a log line is not an
  // ADDRESS. The marker in it says what the table was talking about, the line
  // keeps it in `raw`, and a scene invented for it would stand in the chapter
  // overview without ever having been played.
  test("free text in a log line's scene becomes none, and is reported", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    client
      .prepare("insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30')")
      .run();
    client
      .prepare(
        `insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text)
         values ('beispiel', 's1', 0, '- 19:52 (Abkürzung übers Moor) sie nehmen sie', '19:52', 'Abkürzung übers Moor', 'sie nehmen sie')`,
      )
      .run();

    const outcome = repairReferences(client);

    expect(outcome.entriesCreated).toEqual([]);
    expect(rows(client, "select count(*) as n from scenes")).toEqual([{ n: 0 }]);
    expect(rows(client, "select scene_id, raw from log_entries")).toEqual([
      // The line keeps its own text — the scene marker is IN `raw`, so the
      // evening is readable exactly as it was written.
      {
        scene_id: null,
        raw: "- 19:52 (Abkürzung übers Moor) sie nehmen sie",
      },
    ]);
    expect(outcome.clearedText).toEqual([
      {
        campaignId: "beispiel",
        column: "log_entries.scene_id",
        value: "Abkürzung übers Moor",
        rows: 1,
      },
    ]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("free text in a KEY reference becomes an id with the text as its name", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01");
    addNpc(client, "jorna");
    client
      .prepare("insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30')")
      .run();
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'Alte Fischerin', 0)")
      .run();
    client
      .prepare(
        `insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos)
         values ('beispiel', 'jorna', 'Alte Freundin aus Waterdeep', 'sie schreiben sich', 0)`,
      )
      .run();
    client
      .prepare("insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'Abkürzung übers Moor', 0)")
      .run();

    const outcome = repairReferences(client);

    // Here the reference is part of the KEY: there is no NULL to fall back
    // on, so the entry IS created — under an id, with the text as its name.
    expect(outcome.entriesCreated).toEqual([
      {
        campaignId: "beispiel",
        kind: "npc",
        id: "alte-fischerin",
        fromText: "Alte Fischerin",
      },
      {
        campaignId: "beispiel",
        kind: "npc",
        id: "alte-freundin-aus-waterdeep",
        fromText: "Alte Freundin aus Waterdeep",
      },
      {
        campaignId: "beispiel",
        kind: "scene",
        id: "abkuerzung-uebers-moor",
        fromText: "Abkürzung übers Moor",
      },
    ]);
    expect(rows(client, "select id, name from npcs order by id")).toEqual([
      { id: "alte-fischerin", name: "Alte Fischerin" },
      { id: "alte-freundin-aus-waterdeep", name: "Alte Freundin aus Waterdeep" },
      { id: "jorna", name: "jorna" },
    ]);
    expect(rows(client, "select id, title, chapter_id from scenes order by id")).toEqual([
      { id: "abkuerzung-uebers-moor", title: "Abkürzung übers Moor", chapter_id: UNSORTED_CHAPTER_ID },
      { id: "szene", title: "szene", chapter_id: "01" },
    ]);
    // Every reference survived, pointing at the entry that now carries the
    // text — and the note with it.
    expect(rows(client, "select npc_id from scene_npcs")).toEqual([
      { npc_id: "alte-fischerin" },
    ]);
    expect(rows(client, "select other_npc_id, note from npc_relations")).toEqual([
      { other_npc_id: "alte-freundin-aus-waterdeep", note: "sie schreiben sich" },
    ]);
    expect(rows(client, "select scene_id from session_scenes_played")).toEqual([
      { scene_id: "abkuerzung-uebers-moor" },
    ]);
    // Findable by the text a DM would search for, not only by the slug.
    expect(
      rows(client, "select title from search_fts where entity_id = 'alte-fischerin'"),
    ).toEqual([{ title: "Alte Fischerin" }]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("text that yields no id at all loses its row, like an empty one", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addScene(client, "szene", "01");
    // Nothing survives the transliteration, so there is no id to create and
    // no id to keep. An id is never invented out of nothing.
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', '???', 0)")
      .run();

    const outcome = repairReferences(client);

    expect(outcome.entriesCreated).toEqual([]);
    expect(outcome.dropped).toEqual([
      { campaignId: "beispiel", table: "scene_npcs", rows: 1 },
    ]);
    expect(rows(client, "select count(*) as n from npcs")).toEqual([{ n: 0 }]);
    expect(rows(client, "select count(*) as n from scene_npcs")).toEqual([{ n: 0 }]);
    client.close();
  });

  test("a scene's chapter stored as `[[id]]` re-points instead of doubling it", async () => {
    const client = await legacyDb();
    addChapter(client, "03-x");
    addScene(client, "szene", "[[03-x]]");

    const outcome = repairReferences(client);

    // The chapter the value NAMES exists, so the scene is moved onto it. A
    // second chapter called `[[03-x]]` would satisfy the constraint and put a
    // bracketed id into the overview and into the scene's address.
    expect(outcome.chaptersCreated).toEqual([]);
    expect(outcome.repointed).toEqual([
      {
        campaignId: "beispiel",
        column: "scenes.chapter_id",
        from: "[[03-x]]",
        to: "03-x",
        rows: 1,
      },
    ]);
    expect(rows(client, "select id from chapters")).toEqual([{ id: "03-x" }]);
    expect(rows(client, "select id, chapter_id from scenes")).toEqual([
      { id: "szene", chapter_id: "03-x" },
    ]);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("a scene's chapter stored as `[[id]]` with NO chapter creates the unwrapped one", async () => {
    const client = await legacyDb();
    addScene(client, "szene", "[[03-x]]");

    const outcome = repairReferences(client);

    expect(outcome.chaptersCreated).toEqual([
      { campaignId: "beispiel", chapterId: "03-x", scenes: 1 },
    ]);
    expect(rows(client, "select id, title from chapters")).toEqual([
      { id: "03-x", title: "03-x" },
    ]);
    expect(rows(client, "select id, chapter_id from scenes")).toEqual([
      { id: "szene", chapter_id: "03-x" },
    ]);
    client.close();
  });

  test("the unsorted chapter is reported as created, or as already there", async () => {
    const client = await legacyDb();
    addScene(client, "szene-a", null);
    expect(repairReferences(client).unsorted).toEqual([
      { campaignId: "beispiel", scenes: 1, chapterCreated: true },
    ]);

    // A SECOND boot with a second chapterless scene: the chapter is there
    // already, and a row that did not appear out of nowhere reads very
    // differently in the report.
    addScene(client, "szene-b", null);
    expect(repairReferences(client).unsorted).toEqual([
      { campaignId: "beispiel", scenes: 1, chapterCreated: false },
    ]);
    expect(rows(client, "select count(*) as n from chapters")).toEqual([{ n: 1 }]);
    client.close();
  });

  test("is a no-op on a database without a hole, and idempotent", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    addNpc(client, "jorna");
    client
      .prepare("insert into locations (campaign_id, id, name) values ('beispiel', 'hafen', 'Hafen')")
      .run();
    addScene(client, "szene", "01", "hafen");
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)")
      .run();

    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);

    addScene(client, "waise", "02");
    expect(repairReferences(client).chaptersCreated.length).toBe(1);
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  test("a fresh store the migrator has not built yet is left alone", async () => {
    const client = await openSqlite(":memory:");
    expect(repairReferences(client)).toBe(NO_REFERENCE_REPAIR);
    client.close();
  });

  // What the boot says BEFORE it repairs anything. A row that already breaks
  // a constraint its own database carries is not the repair's business — but
  // it IS what the migration's table rebuilds fail on, and a failed rebuild
  // named no row at all.
  describe("the check in front of the repair", () => {
    function captureLog(): { lines: string[]; restore: () => void } {
      const lines: string[] = [];
      const original = console.log;
      console.log = (...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(" "));
      };
      return { lines, restore: () => (console.log = original) };
    }

    test("says nothing on a database whose references all hold", async () => {
      const client = await legacyDb();
      applyMigration(client, CHAPTER_FK);
      applyMigration(client, REFERENCE_FKS);
      const log = captureLog();
      try {
        reportForeignKeyViolations(client);
      } finally {
        log.restore();
      }
      expect(log.lines).toEqual([]);
      client.close();
    });

    test("names the table of a row that breaks a constraint already in place", async () => {
      const client = await legacyDb();
      applyMigration(client, CHAPTER_FK);
      applyMigration(client, REFERENCE_FKS);
      // Only with enforcement OFF can such a row get in — which is exactly
      // how a database arrives carrying one.
      client.exec("PRAGMA foreign_keys = OFF");
      addScene(client, "szene", "kein-kapitel");
      client.exec("PRAGMA foreign_keys = ON");

      const log = captureLog();
      try {
        reportForeignKeyViolations(client);
      } finally {
        log.restore();
      }
      expect(log.lines[0]).toContain("1 row(s) already break a foreign key");
      expect(log.lines[1]).toContain("scenes: 1 row(s)");
      client.close();
    });

    test("is silent on a store that has no tables yet", async () => {
      const client = await openSqlite(":memory:");
      const log = captureLog();
      try {
        reportForeignKeyViolations(client);
      } finally {
        log.restore();
      }
      expect(log.lines).toEqual([]);
      client.close();
    });
  });

  // The promise the whole step exists for, end to end: the same legacy
  // database, once with the repair and once without.
  test("the migration goes through after the repair and fails without it", async () => {
    async function withHoles(): Promise<SqliteClient> {
      const client = await legacyDb();
      addScene(client, "szene", null, "bucht");
      return client;
    }

    const unrepaired = await withHoles();
    expect(() =>
      unrepaired
        .transaction(() => {
          applyMigration(unrepaired, CHAPTER_FK);
          applyMigration(unrepaired, REFERENCE_FKS);
        })
        .immediate(),
    ).toThrow();
    unrepaired.close();

    const repaired = await withHoles();
    const outcome = repairReferences(repaired);
    expect(outcome.unsorted).toEqual([{ campaignId: "beispiel", scenes: 1, chapterCreated: true }]);
    expect(outcome.entriesCreated).toEqual([
      { campaignId: "beispiel", kind: "location", id: "bucht" },
    ]);
    repaired
      .transaction(() => {
        applyMigration(repaired, CHAPTER_FK);
        applyMigration(repaired, REFERENCE_FKS);
      })
      .immediate();
    expect(rows(repaired, "select id, chapter_id, location from scenes")).toEqual([
      { id: "szene", chapter_id: UNSORTED_CHAPTER_ID, location: "bucht" },
    ]);
    repaired.close();
  });
});

// Every constraint the slice adds, at SQL level on a fully migrated database.
// One case per column, because "the schema says so" is not a promise until
// the database refuses the row.
describe("the reference constraints", () => {
  /** A campaign with one chapter, one location, one npc, one scene. */
  function seed(db: Awaited<ReturnType<typeof openDb>>["db"]): void {
    db.run(sql`insert into campaigns (id, name) values ('beispiel', 'Beispiel')`);
    db.run(sql`insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Eins', 0)`);
    db.run(sql`insert into locations (campaign_id, id, name) values ('beispiel', 'hafen', 'Hafen')`);
    db.run(sql`insert into npcs (campaign_id, id, name) values ('beispiel', 'jorna', 'Jorna')`);
    db.run(
      sql`insert into scenes (campaign_id, id, chapter_id, location, title, pos) values ('beispiel', 'szene', '01', 'hafen', 'Szene', 0)`,
    );
    db.run(sql`insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30')`);
  }

  const dangling: Array<{ what: string; insert: string }> = [
    {
      what: "a scene under a chapter that has no row",
      insert:
        "insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'neu', '99-nichts', 'Neu', 1)",
    },
    {
      what: "a scene in a location that has no row",
      insert:
        "insert into scenes (campaign_id, id, chapter_id, location, title, pos) values ('beispiel', 'neu', '01', 'nirgendwo', 'Neu', 1)",
    },
    {
      what: "a scene's npc list naming an npc that has no row",
      insert:
        "insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'holm', 0)",
    },
    {
      what: "a relation counterpart that has no row",
      insert:
        "insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values ('beispiel', 'jorna', 'holm', '', 0)",
    },
    {
      what: "an npc grouped under a chapter that has no row",
      insert:
        "insert into npcs (campaign_id, id, name, chapter_id) values ('beispiel', 'holm', 'Holm', '99-nichts')",
    },
    {
      what: "a location grouped under a chapter that has no row",
      insert:
        "insert into locations (campaign_id, id, name, chapter_id) values ('beispiel', 'bucht', 'Bucht', '99-nichts')",
    },
    {
      what: "a log line naming a scene that has no row",
      insert:
        "insert into log_entries (campaign_id, session_id, pos, raw, scene_id) values ('beispiel', 's1', 0, '- 19:52 (weg) los', 'weg')",
    },
    {
      what: "a played list naming a scene that has no row",
      insert:
        "insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'weg', 0)",
    },
  ];

  for (const entry of dangling) {
    test(`rejects ${entry.what}`, async () => {
      const { db, close } = await openDb(":memory:");
      try {
        seed(db);
        expect(() => db.run(sql.raw(entry.insert))).toThrow();
      } finally {
        close();
      }
    });
  }

  test("rejects a scene without a chapter — the column is NOT NULL", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      seed(db);
      expect(() =>
        db.run(
          sql`insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'frei', null, 'Szene', 1)`,
        ),
      ).toThrow();
      expect(db.all(sql`select id from scenes where id = 'frei'`)).toEqual([]);
      // An empty `location`, in contrast, is legal: naming one is optional.
      db.run(
        sql`insert into scenes (campaign_id, id, chapter_id, location, title, pos) values ('beispiel', 'frei', '01', null, 'Szene', 1)`,
      );
      expect(db.all(sql`select id from scenes where id = 'frei'`)).toEqual([{ id: "frei" }]);
    } finally {
      close();
    }
  });

  test("a rename cascades into every reference of the renamed row", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      seed(db);
      db.run(
        sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)`,
      );
      db.run(
        sql`insert into log_entries (campaign_id, session_id, pos, raw, scene_id) values ('beispiel', 's1', 0, '- 19:52 (szene) los', 'szene')`,
      );
      db.run(
        sql`insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'szene', 0)`,
      );

      db.run(sql`update chapters set id = '01-salzhafen' where campaign_id = 'beispiel'`);
      db.run(sql`update locations set id = 'alte-mole' where campaign_id = 'beispiel'`);
      db.run(sql`update npcs set id = 'jorna-die-alte' where campaign_id = 'beispiel'`);
      db.run(sql`update scenes set id = 'ankunft' where campaign_id = 'beispiel' and id = 'szene'`);

      expect(db.all(sql`select chapter_id, location, id from scenes`)).toEqual([
        { chapter_id: "01-salzhafen", location: "alte-mole", id: "ankunft" },
      ]);
      expect(db.all(sql`select scene_id, npc_id from scene_npcs`)).toEqual([
        { scene_id: "ankunft", npc_id: "jorna-die-alte" },
      ]);
      expect(db.all(sql`select scene_id from log_entries`)).toEqual([{ scene_id: "ankunft" }]);
      expect(db.all(sql`select scene_id from session_scenes_played`)).toEqual([
        { scene_id: "ankunft" },
      ]);
    } finally {
      close();
    }
  });

  // The other half of every ON DELETE decision: a delete that would orphan
  // authored data FAILS instead of blanking or cascading it away.
  test("refuses to delete a row that is still referenced", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      seed(db);
      db.run(
        sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)`,
      );
      // The chapter owns scenes, the location has scenes in it, the npc is
      // listed by one — none of the three may be deleted sideways.
      expect(() => db.run(sql`delete from chapters where campaign_id = 'beispiel'`)).toThrow();
      expect(() => db.run(sql`delete from locations where campaign_id = 'beispiel'`)).toThrow();
      expect(() => db.run(sql`delete from npcs where campaign_id = 'beispiel'`)).toThrow();
      expect(db.all(sql`select id from chapters`)).toEqual([{ id: "01" }]);
      expect(db.all(sql`select id from locations`)).toEqual([{ id: "hafen" }]);
      expect(db.all(sql`select id from npcs`)).toEqual([{ id: "jorna" }]);
    } finally {
      close();
    }
  });

  test("a join row dies with its parent, and a session takes its log with it", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      seed(db);
      db.run(
        sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)`,
      );
      db.run(
        sql`insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'szene', 'social', 0)`,
      );
      db.run(
        sql`insert into log_entries (campaign_id, session_id, pos, raw, scene_id) values ('beispiel', 's1', 0, '- 19:52 (szene) los', 'szene')`,
      );
      // The session goes (the one delete the product performs — discarding an
      // empty session), and its log goes with it.
      db.run(sql`delete from sessions where campaign_id = 'beispiel'`);
      expect(db.all(sql`select pos from log_entries`)).toEqual([]);
      // The scene's own list entries die with the SCENE, which is the only
      // way they are deleted at all.
      db.run(sql`delete from scenes where campaign_id = 'beispiel'`);
      expect(db.all(sql`select npc_id from scene_npcs`)).toEqual([]);
      expect(db.all(sql`select tag from scene_tags`)).toEqual([]);
    } finally {
      close();
    }
  });

  // The restricting references must not make a campaign undeletable: the
  // campaign cascade has to reach everything, or emptying a database would
  // dead-end on a chapter its own scenes are blocking.
  test("deleting a campaign still takes the whole campaign with it", async () => {
    const { db, close } = await openDb(":memory:");
    try {
      seed(db);
      db.run(
        sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)`,
      );
      db.run(
        sql`insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values ('beispiel', 'jorna', 'jorna', '', 0)`,
      );
      db.run(
        sql`insert into log_entries (campaign_id, session_id, pos, raw, scene_id) values ('beispiel', 's1', 0, '- 19:52 (szene) los', 'szene')`,
      );
      db.run(
        sql`insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'szene', 0)`,
      );

      db.run(sql`delete from campaigns where id = 'beispiel'`);

      for (const table of [
        "chapters",
        "scenes",
        "locations",
        "npcs",
        "npc_relations",
        "scene_npcs",
        "sessions",
        "log_entries",
        "session_scenes_played",
      ]) {
        expect(db.all(sql.raw(`select count(*) as n from ${table}`))).toEqual([{ n: 0 }]);
      }
    } finally {
      close();
    }
  });
});

describe("the rebuilds of migration 0015", () => {
  // The hand-edited half of the migration (see its header): the migrator runs
  // every migration in ONE transaction, where `PRAGMA foreign_keys=OFF` is a
  // no-op — so a plain `DROP TABLE` performs an implicit delete that CASCADES
  // into the children of the rebuilt table. The migration sets those rows
  // aside and puts them back, and this is the test that catches it going back
  // to the generated version: real child rows in, then the rebuilds the way
  // the migrator applies them.
  test("keep every child row of the tables they rebuild", async () => {
    const client = await legacyDb();
    addChapter(client, "01");
    client
      .prepare("insert into locations (campaign_id, id, name) values ('beispiel', 'hafen', 'Hafen')")
      .run();
    addNpc(client, "jorna");
    addNpc(client, "holm");
    addScene(client, "szene", "01", "hafen");
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)")
      .run();
    client
      .prepare("insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'szene', 'social', 0)")
      .run();
    client
      .prepare("insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values ('beispiel', 'jorna', 'holm', 'schuldet Geld', 0)")
      .run();
    client
      .prepare("insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30')")
      .run();
    client
      .prepare("insert into log_entries (campaign_id, session_id, pos, raw, scene_id) values ('beispiel', 's1', 0, '- 19:52 (szene) los', 'szene')")
      .run();
    client
      .prepare("insert into session_scenes_played (campaign_id, session_id, scene_id, pos) values ('beispiel', 's1', 'szene', 0)")
      .run();

    client
      .transaction(() => {
        applyMigration(client, CHAPTER_FK);
        applyMigration(client, REFERENCE_FKS);
      })
      .immediate();

    expect(rows(client, "select scene_id, npc_id, pos from scene_npcs")).toEqual([
      { scene_id: "szene", npc_id: "jorna", pos: 0 },
    ]);
    expect(rows(client, "select scene_id, tag, pos from scene_tags")).toEqual([
      { scene_id: "szene", tag: "social", pos: 0 },
    ]);
    expect(rows(client, "select npc_id, other_npc_id, note from npc_relations")).toEqual([
      { npc_id: "jorna", other_npc_id: "holm", note: "schuldet Geld" },
    ]);
    expect(rows(client, "select session_id, scene_id from log_entries")).toEqual([
      { session_id: "s1", scene_id: "szene" },
    ]);
    expect(rows(client, "select scene_id, pos from session_scenes_played")).toEqual([
      { scene_id: "szene", pos: 0 },
    ]);
    expect(rows(client, "select id, chapter_id, location from scenes")).toEqual([
      { id: "szene", chapter_id: "01", location: "hafen" },
    ]);
    // …and no temporary table is left behind.
    expect(
      rows(client, "select name from sqlite_master where name like '\\_\\_%' escape '\\'"),
    ).toEqual([]);
    client.close();
  });
});

// The upgrade itself, on the production path: a database that stopped at an
// EARLIER migration is opened by `openDb`, which runs the reference repair on
// the raw client and then lets the real migrator carry it the rest of the
// way. Four starting points matter:
//
//   * 0010 — `scenes.chapter_declared` is still there, and so are the two
//     import bookkeeping tables. The database has to go through the drops AND
//     the rebuilds in one boot.
//   * 0011 — the column is already gone.
//   * 0012 — the import tables are gone too. This is the newest state a
//     production database can be in.
//   * 0013 — everything but the constraints themselves.
//
// All of them assert on ROWS, not just on "it did not throw": the rebuilds
// drop and recreate five tables, and the whole point of their hand-edited
// half is that nothing is lost while they do.
describe("upgrading an existing database through the reference constraints", () => {
  /**
   * A real database, migrated by hand up to `tag` and told so the way the
   * migrator records it: `created_at` is the journal's `when`, which is what
   * the dialect compares against to decide what is still outstanding.
   */
  async function dbStoppedAt(
    dir: string,
    tag: string,
    seed: (client: SqliteClient) => void,
  ): Promise<string> {
    const dbPath = path.join(dir, `${tag}.db`);
    const client = await openSqlite(dbPath);
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
    return dbPath;
  }

  /** One of everything, and one hole of every kind the repair has to close. */
  function seedCampaign(client: SqliteClient): void {
    client.prepare("insert into campaigns (id, name) values ('beispiel', 'Beispiel')").run();
    addChapter(client, "01-salzhafen");
    client
      .prepare("insert into locations (campaign_id, id, name) values ('beispiel', 'hafen', 'Hafen')")
      .run();
    addNpc(client, "jorna");
    addScene(client, "szene", "01-salzhafen", "hafen");
    // The production case the repair exists for: a chapter nobody created.
    addScene(client, "waise", "03-dragon-hatchery");
    // A scene with no chapter at all, and one naming a location with no entry.
    addScene(client, "heimatlos", null);
    addScene(client, "bucht-szene", "01-salzhafen", "bucht");
    client
      .prepare("insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'szene', 'social', 0)")
      .run();
    client
      .prepare("insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'jorna', 0)")
      .run();
    // A relation counterpart with no entry, in the bracket spelling.
    client
      .prepare("insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values ('beispiel', 'jorna', '[[fenn]]', 'alte Bekannte', 0)")
      .run();
  }

  /** What every one of these boots has to end up with. */
  async function expectUpgraded(dbPath: string): Promise<void> {
    const { db, referenceRepair, close } = await openDb(dbPath);
    try {
      // The repair ran and reported every hole it closed.
      expect(referenceRepair.chaptersCreated).toEqual([
        { campaignId: "beispiel", chapterId: "03-dragon-hatchery", scenes: 1 },
      ]);
      expect(referenceRepair.unsorted).toEqual([{ campaignId: "beispiel", scenes: 1, chapterCreated: true }]);
      expect(referenceRepair.entriesCreated).toEqual([
        { campaignId: "beispiel", kind: "location", id: "bucht" },
        { campaignId: "beispiel", kind: "npc", id: "fenn" },
      ]);
      // Every scene survived the rebuild with its references intact.
      expect(db.all(sql`select id, chapter_id, location from scenes order by id`)).toEqual([
        { id: "bucht-szene", chapter_id: "01-salzhafen", location: "bucht" },
        { id: "heimatlos", chapter_id: UNSORTED_CHAPTER_ID, location: null },
        { id: "szene", chapter_id: "01-salzhafen", location: "hafen" },
        { id: "waise", chapter_id: "03-dragon-hatchery", location: null },
      ]);
      // …and so did the child rows the rebuilds set aside by hand.
      expect(db.all(sql`select scene_id, tag from scene_tags`)).toEqual([
        { scene_id: "szene", tag: "social" },
      ]);
      expect(db.all(sql`select scene_id, npc_id from scene_npcs`)).toEqual([
        { scene_id: "szene", npc_id: "jorna" },
      ]);
      expect(db.all(sql`select npc_id, other_npc_id, note from npc_relations`)).toEqual([
        { npc_id: "jorna", other_npc_id: "fenn", note: "alte Bekannte" },
      ]);
      // The dropped column is gone, the added one is there.
      const sceneColumns = (
        db.all(sql`select name from pragma_table_info('scenes')`) as Array<{ name: string }>
      ).map((row) => row.name);
      expect(sceneColumns).not.toContain("chapter_declared");
      expect(sceneColumns).toContain("chapter_id");
      expect(
        (
          db.all(sql`select name from pragma_table_info('generate_jobs')`) as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      ).toContain("new_chapter_title");
      // Whatever the starting point was, the two import bookkeeping tables
      // main dropped are gone afterwards — the rebuilds do not bring them
      // back and the boot does not miss them.
      const tables = (
        db.all(sql`select name from sqlite_master where type = 'table'`) as Array<{ name: string }>
      ).map((row) => row.name);
      expect(tables).not.toContain("unknown_files");
      expect(tables).not.toContain("migration_report");
      // The database itself agrees that nothing dangles any more.
      expect(db.all(sql`pragma foreign_key_check`)).toEqual([]);
      // And the constraints the whole slice is for are enforcing.
      expect(() =>
        db.run(
          sql`insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'neu', '99-nichts', 'Neu', 9)`,
        ),
      ).toThrow();
      expect(() =>
        db.run(
          sql`insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'szene', 'niemand', 9)`,
        ),
      ).toThrow();
      // A second boot is a no-op: nothing left to repair, nothing outstanding.
      const again = await openDb(dbPath);
      expect(again.referenceRepair).toBe(NO_REFERENCE_REPAIR);
      expect(again.db.all(sql`select count(*) as n from scenes`)).toEqual([{ n: 4 }]);
      again.close();
    } finally {
      close();
    }
  }

  test("a database at 0010 goes through the drops and the rebuilds in one boot", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0010-"));
    try {
      // The starting point has to be the OLD shape, or the test proves nothing.
      const before = await openSqlite(path.join(dir, "probe.db"));
      applyMigrationsThrough(before, PIPELINE_PARTS);
      expect(
        (
          before.prepare("select name from pragma_table_info('scenes')").all() as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      ).toContain("chapter_declared");
      before.close();

      await expectUpgraded(await dbStoppedAt(dir, PIPELINE_PARTS, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database at 0011 already has the column dropped and takes the rebuilds", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0011-"));
    try {
      await expectUpgraded(await dbStoppedAt(dir, DROP_CHAPTER_DECLARED, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database at 0012 has lost the import tables and still takes the rebuilds", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0012-"));
    try {
      const before = await openSqlite(path.join(dir, "probe.db"));
      applyMigrationsThrough(before, DROP_IMPORT_BOOKKEEPING);
      expect(
        (
          before.prepare("select name from sqlite_master where type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      ).not.toContain("unknown_files");
      before.close();

      await expectUpgraded(await dbStoppedAt(dir, DROP_IMPORT_BOOKKEEPING, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database at 0013 takes the two constraint migrations back to back", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grimoire-mig-0013-"));
    try {
      await expectUpgraded(await dbStoppedAt(dir, LEGACY, seedCampaign));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
