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
// Migration 0012 turns that reference into a real FOREIGN KEY, and it copies
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
// It is a no-op on every database that has no orphan — which, after the FK of
// migration 0012, is every database the server itself ever writes.

import type { SqliteClient } from "./driver";

/** One chapter row this step had to create. */
export interface ChapterRepairEntry {
  campaignId: string;
  /** The chapter id the scenes named — and now the chapter's title too. */
  chapterId: string;
  /** How many scenes were hanging under it. */
  scenes: number;
}

export interface ChapterRepairOutcome {
  /** The chapters created, ordered by campaign and id. */
  created: ChapterRepairEntry[];
}

export const NO_CHAPTER_REPAIR: ChapterRepairOutcome = { created: [] };

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

/**
 * Create the missing chapter rows. Returns what it created, which the boot
 * log reports; `NO_CHAPTER_REPAIR` on a database without the tables (a fresh
 * file before the migrator has run) or without a hole.
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
  if (orphans.length === 0) return NO_CHAPTER_REPAIR;

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

  const created: ChapterRepairEntry[] = [];
  client
    .transaction(() => {
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
  return { created };
}
