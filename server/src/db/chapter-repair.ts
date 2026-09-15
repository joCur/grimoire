// The one-time data step behind issue #115: a `scenes.chapter_id` without a
// `chapters` row gets one.
//
// WHY IT EXISTS
//
// `scenes.chapter_id` used to be a SOFT reference (schema.ts rule 3), and the
// generator's accept step wrote scenes whose chapter it had been told about
// only by the browser. After #97 made the review persistent that browser state
// was regularly gone, so production ended up with twelve scenes under
// `03-dragon-hatchery` and no such chapter — and the pool lists chapters from
// the chapter TABLE, so the chapter and every scene in it were invisible.
//
// WHY IT RUNS BEFORE THE SCHEMA MIGRATOR
//
// Migration 0014 turns that reference into a real FOREIGN KEY, and it copies
// the scene rows into the new table — which is exactly the statement an orphan
// `chapter_id` would fail. So the holes have to be closed while the old,
// unconstrained schema is still in place: `openDb` runs this on the raw client
// before `migrateDb`, the same pre-migration slot db/group-migration.ts sits
// in and for the same reason.
//
// WHAT IT CREATES
//
// `{ id, title: id, status: "planned" }` — the chapter is named by its own
// slug, which is the only name anybody has for it, and the DM renames it in
// the pool („Eigenschaften"). Everything created is REPORTED on boot (the
// shape issue #100 established), because a chapter appearing out of nowhere is
// something the DM should read rather than discover.
//
// WHAT IT BLANKS
//
// A `chapter_id` that is present but EMPTY (`''`, or nothing but whitespace)
// names no chapter at all, so there is nothing to create for it — and it is
// not NULL either, so migration 0014's composite foreign key would demand a
// chapters row with the empty id and fail the boot. Such a value is therefore
// set to NULL in the SAME transaction as the creates: NULL is what "this scene
// has no chapter" has always meant, the scene stays where the DM can see it,
// and the FK is satisfied. It is reported too, for the same reason the creates
// are — a scene that lost its chapter reference should be read, not
// discovered.
//
// It is a no-op on every database that has no orphan and no blank — which,
// after the FK of migration 0014, is every database the server itself ever
// writes.
//
// WHAT SHAPE IT HAS TO COPE WITH
//
// Whatever the last migration a database went through left behind. It reads
// and writes `scenes.campaign_id` and `scenes.chapter_id` and nothing else,
// so the column set around them is none of its business — which is what lets
// it run unchanged on a database still carrying `scenes.chapter_declared`
// (before migration 0011 dropped it) and on one that already lost it.

import type { SqliteClient } from "./driver";

/** One chapter row this step had to create. */
export interface ChapterRepairEntry {
  campaignId: string;
  /** The chapter id the scenes named — and now the chapter's title too. */
  chapterId: string;
  /** How many scenes were hanging under it. */
  scenes: number;
}

/** One campaign whose scenes carried a blank `chapter_id`, now NULL. */
export interface ChapterBlankEntry {
  campaignId: string;
  /** How many scenes were holding the empty value. */
  scenes: number;
}

export interface ChapterRepairOutcome {
  /** The chapters created, ordered by campaign and id. */
  created: ChapterRepairEntry[];
  /** The campaigns whose blank `chapter_id`s became NULL, ordered by id. */
  blanked: ChapterBlankEntry[];
}

export const NO_CHAPTER_REPAIR: ChapterRepairOutcome = { created: [], blanked: [] };

function hasTable(client: SqliteClient, name: string): boolean {
  return (
    client
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .all(name).length > 0
  );
}

interface OrphanRow {
  campaign_id: string;
  chapter_id: string;
  n: number;
}

interface BlankRow {
  campaign_id: string;
  n: number;
}

/**
 * Close both kinds of hole: create the missing chapter rows, and NULL the
 * `chapter_id`s that are blank. Returns what it did, which the boot log
 * reports; `NO_CHAPTER_REPAIR` on a database without the tables (a fresh file
 * before the migrator has run) or without a hole.
 */
export function repairOrphanChapters(client: SqliteClient): ChapterRepairOutcome {
  if (!hasTable(client, "scenes") || !hasTable(client, "chapters")) return NO_CHAPTER_REPAIR;

  const orphans = client
    .prepare(
      `select s.campaign_id as campaign_id, s.chapter_id as chapter_id, count(*) as n
         from scenes s
        where s.chapter_id is not null
          and trim(s.chapter_id) <> ''
          and not exists (
                select 1 from chapters c
                 where c.campaign_id = s.campaign_id and c.id = s.chapter_id)
        group by s.campaign_id, s.chapter_id
        order by s.campaign_id, s.chapter_id`,
    )
    .all() as unknown as OrphanRow[];

  // Present but empty: names no chapter, and is not NULL either — so it has
  // nothing to create and would still fail migration 0014's foreign key.
  const blanks = client
    .prepare(
      `select s.campaign_id as campaign_id, count(*) as n
         from scenes s
        where s.chapter_id is not null
          and trim(s.chapter_id) = ''
        group by s.campaign_id
        order by s.campaign_id`,
    )
    .all() as unknown as BlankRow[];

  if (orphans.length === 0 && blanks.length === 0) return NO_CHAPTER_REPAIR;

  const insertChapter = client.prepare(
    // `title = id` on purpose — see the note at the top. `pos` puts the
    // repaired chapter LAST in its campaign, which is where an unplaced
    // chapter belongs; the DM reorders nothing today, so any other choice
    // would only push the known chapters around.
    `insert into chapters (campaign_id, id, title, status, body, extra, pos, rev)
     values (?, ?, ?, 'planned', '', '{}',
             coalesce((select max(pos) + 1 from chapters where campaign_id = ?), 0), 1)`,
  );
  // Prepared on first use: a database whose virtual FTS table was never
  // created (the smoke tests build tables by hand) must not fail the boot
  // over an index the search will rebuild anyway.
  let indexChapter: ReturnType<SqliteClient["prepare"]> | undefined;

  const blankOut = client.prepare(
    `update scenes set chapter_id = null
      where campaign_id = ? and chapter_id is not null and trim(chapter_id) = ''`,
  );

  const created: ChapterRepairEntry[] = [];
  const blanked: ChapterBlankEntry[] = [];
  client
    .transaction(() => {
      // The blanks first: they are the rows migration 0014 would trip over,
      // and neither half depends on the other.
      for (const row of blanks) {
        blankOut.run(row.campaign_id);
        blanked.push({ campaignId: row.campaign_id, scenes: Number(row.n) });
      }
      for (const row of orphans) {
        insertChapter.run(row.campaign_id, row.chapter_id, row.chapter_id, row.campaign_id);
        try {
          indexChapter ??= client.prepare(
            `insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
             values (?, ?, '', '', ?, 'chapter', ?)`,
          );
          indexChapter.run(row.chapter_id, row.chapter_id, row.campaign_id, row.chapter_id);
        } catch {
          // No FTS table on this database — the row is what matters.
        }
        created.push({
          campaignId: row.campaign_id,
          chapterId: row.chapter_id,
          scenes: Number(row.n),
        });
      }
    })
    .immediate();
  return { created, blanked };
}
