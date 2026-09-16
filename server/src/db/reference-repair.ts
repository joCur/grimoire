// The one-time data step in front of the reference constraints: every column
// that names another row is made to name one that exists.
//
// WHY IT EXISTS
//
// Every reference in the schema is a real foreign key (schema.ts rule 3), and
// migration 0015 installs the missing ones by COPYING the rows into rebuilt
// tables — which is exactly the statement a reference that names nothing
// fails. So the holes have to be closed while the old, unconstrained schema
// is still in place: `openDb` runs this on the raw client before `migrateDb`,
// the same pre-migration slot db/group-migration.ts sits in and for the same
// reason.
//
// WHAT IT CLOSES
//
//   * a scene with NO chapter (NULL or blank). A scene belongs to a chapter —
//     the chapter is part of its address — so it gets one: the campaign's
//     `unsortiert` chapter, created for the purpose. Failing the boot instead
//     would leave the DM with a server that does not start over data they
//     cannot reach; an address they can see and change is the repair.
//   * a scene whose `chapter_id` names no chapter. The generator's accept step
//     wrote exactly that (the browser held the chapter, the job did not), and
//     production ended up with twelve scenes under `03-dragon-hatchery` and no
//     such chapter — the overview lists chapters from the chapter TABLE, so
//     the chapter and every scene in it were invisible. The chapter is
//     created, named by its own slug.
//   * a reference that names an entry the campaign does not have — a scene's
//     `location`, a scene's npc list, the counterpart of a relation line, the
//     scene a log line or a played list names. The entry is CREATED, empty:
//     that is the standing rule for every write path ("referencing creates",
//     ADR #14), and it is the repair that loses nothing.
//   * a reference that names NOTHING AT ALL (empty or whitespace). There is no
//     entry to create for it: where the column is nullable it becomes NULL,
//     which is what "no reference" has always meant, and where it is part of
//     a key the row goes — it carried no information to keep.
//
// THE ONE KIND THAT IS NOT CREATED IS A CHAPTER NAMED BY A NOTE. An npc's and
// a location's `chapter:` is an optional grouping, not an address, and
// chapters are deliberately not created by naming them (ADR #14 — the API
// answers 400 there): such a value becomes NULL rather than putting a chapter
// nobody authored into the overview. A SCENE's chapter is the opposite case —
// it IS the address, so there the chapter is created.
//
// A WRAPPED REFERENCE IS UNWRAPPED FIRST. Production holds relation lines
// whose counterpart was stored as `[[frulam-mondath]]` — the body-reference
// spelling in a field that holds a plain id. The id inside the brackets is the
// npc the line is about, so the reference is re-pointed at it instead of
// answered with an invented entry called `[[frulam-mondath]]`. That entry
// would satisfy the constraint and get the data wrong twice: a second entry
// for an npc who already has one, under a name no DM would recognise. The
// unwrapped id is what gets the empty entry when IT has no row either — the
// brackets are notation, never part of an id.
//
// EVERYTHING IT DOES IS REPORTED at boot (server.ts), because a row appearing
// out of nowhere is something the DM should read rather than discover.
//
// It is a no-op on every database that has no hole — which, after migration
// 0015, is every database the server itself ever writes.
//
// WHAT SHAPE IT HAS TO COPE WITH
//
// Whatever the last migration a database went through left behind. It reads
// and writes the reference columns and nothing else, so the column set around
// them is none of its business — which is what lets it run unchanged on a
// database still carrying `scenes.chapter_declared` (before migration 0011
// dropped it) and on one that already lost it. A table or column that is not
// there yet is skipped instead of guessed at.

import { ENTITY_SLUG } from "@grimoire/shared";
import type { SqliteClient } from "./driver";

/** The chapter that takes in scenes which name none. */
export const UNSORTED_CHAPTER_ID = "unsortiert";
export const UNSORTED_CHAPTER_TITLE = "Unsortiert";

/** One chapter row this step had to create, and for how many scenes. */
export interface ChapterCreated {
  campaignId: string;
  /** The chapter id the scenes named — and now the chapter's title too. */
  chapterId: string;
  /** How many scenes were hanging under it. */
  scenes: number;
}

/** One campaign whose chapterless scenes were moved into `unsortiert`. */
export interface ScenesUnsorted {
  campaignId: string;
  /** How many scenes had no chapter at all. */
  scenes: number;
}

/** One empty entry created for a reference that named no row. */
export interface EntryCreated {
  campaignId: string;
  kind: EntryKind;
  id: string;
}

/** One reference re-pointed at the entry it actually named. */
export interface ReferenceRepointed {
  campaignId: string;
  /** The column the value stood in, as `<table>.<column>`. */
  column: string;
  from: string;
  to: string;
  rows: number;
}

/** Reference values that named nothing and are NULL now, per column. */
export interface ReferenceCleared {
  campaignId: string;
  column: string;
  rows: number;
}

/** Reference rows that named nothing and could not be kept, per table. */
export interface ReferenceDropped {
  campaignId: string;
  table: string;
  rows: number;
}

export interface ReferenceRepairOutcome {
  /** Chapters created because a scene named one with no row. */
  chaptersCreated: ChapterCreated[];
  /** Campaigns whose chapterless scenes moved into `unsortiert`. */
  unsorted: ScenesUnsorted[];
  /** Empty entries created for a reference that named no row. */
  entriesCreated: EntryCreated[];
  /** References re-pointed at the entry they actually named. */
  repointed: ReferenceRepointed[];
  /** Optional references that named nothing and are NULL now. */
  cleared: ReferenceCleared[];
  /** Reference rows that named nothing and were dropped. */
  dropped: ReferenceDropped[];
}

export const NO_REFERENCE_REPAIR: ReferenceRepairOutcome = {
  chaptersCreated: [],
  unsorted: [],
  entriesCreated: [],
  repointed: [],
  cleared: [],
  dropped: [],
};

/** The three kinds a reference can bring into existence. */
type EntryKind = "npc" | "location" | "scene";

/** One reference column and the table it points into. */
interface RefColumn {
  table: string;
  column: string;
  target: string;
}

/**
 * A NULLABLE reference column. `creates` is the entry kind a value with no row
 * brings into existence, or `false` for the one exception (a chapter named by
 * a note, see the header) — that value becomes NULL.
 */
interface OptionalRef extends RefColumn {
  creates: EntryKind | false;
}

/**
 * A reference column that is part of the table's KEY, so it has no NULL to
 * fall back on. `keyColumns` are the other key columns, needed to find the row
 * a re-pointing would duplicate.
 */
interface RequiredRef extends RefColumn {
  keyColumns: string[];
}

/** The nullable references, in the order they are repaired. */
const OPTIONAL_REFS: readonly OptionalRef[] = [
  { table: "scenes", column: "location", target: "locations", creates: "location" },
  { table: "npcs", column: "chapter_id", target: "chapters", creates: false },
  { table: "locations", column: "chapter_id", target: "chapters", creates: false },
  { table: "log_entries", column: "scene_id", target: "scenes", creates: "scene" },
];

/** The references that are part of a key. */
const REQUIRED_REFS: readonly RequiredRef[] = [
  { table: "scene_npcs", column: "npc_id", target: "npcs", keyColumns: ["scene_id"] },
  { table: "npc_relations", column: "other_npc_id", target: "npcs", keyColumns: ["npc_id"] },
  {
    table: "session_scenes_played",
    column: "scene_id",
    target: "scenes",
    keyColumns: ["session_id", "pos"],
  },
];

/** The entry table of a reference target, and the kind it holds. */
const KIND_OF_TARGET: Record<string, EntryKind> = {
  npcs: "npc",
  locations: "location",
  scenes: "scene",
};

/** One reference hole: the value, its campaign, and how many rows hold it. */
interface HoleRow {
  campaign_id: string;
  value: string;
  n: number;
}

interface CountRow {
  campaign_id: string;
  n: number;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hasTable(client: SqliteClient, name: string): boolean {
  return (
    client
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .all(name).length > 0
  );
}

function hasColumn(client: SqliteClient, table: string, column: string): boolean {
  if (!hasTable(client, table)) return false;
  return (
    client.prepare("select name from pragma_table_info(?)").all(table) as Array<{ name: string }>
  ).some((row) => row.name === column);
}

/**
 * The id a stored reference MEANT: `[[jorna]]` in a field that holds a plain
 * id is the body-reference spelling in the wrong place, and the id is the one
 * inside the brackets (see the header). Everything else comes back as it
 * stands — this unwraps, it never guesses.
 */
function unwrapRef(value: string): string {
  const wrapped = /^\[\[(.+)\]\]$/.exec(value.trim());
  const inner = (wrapped?.[1] ?? "").trim();
  return ENTITY_SLUG.test(inner) ? inner : value;
}

/**
 * Close every reference hole, in ONE transaction: either the database is
 * ready for the constraints or it is untouched. Returns what it did, which
 * the boot log reports; `NO_REFERENCE_REPAIR` when there was nothing to do
 * (including on a fresh store the migrator has not built yet).
 */
export function repairReferences(client: SqliteClient): ReferenceRepairOutcome {
  if (!hasTable(client, "scenes") || !hasTable(client, "chapters")) return NO_REFERENCE_REPAIR;

  const outcome: ReferenceRepairOutcome = {
    chaptersCreated: [],
    unsorted: [],
    entriesCreated: [],
    repointed: [],
    cleared: [],
    dropped: [],
  };

  const createChapter = client.prepare(
    // `title = id` on purpose for a repaired chapter — the slug is the only
    // name anybody has for it, and the DM renames it in the overview. `pos`
    // puts it LAST in its campaign, which is where an unplaced chapter
    // belongs; any other choice would push the known chapters around.
    `insert into chapters (campaign_id, id, title, status, body, extra, pos, rev)
     values (?, ?, ?, 'planned', '', '{}',
             coalesce((select max(pos) + 1 from chapters where campaign_id = ?), 0), 1)`,
  );
  // Prepared on first use: a database whose virtual FTS table was never
  // created (the smoke tests build their tables by hand) must not fail the
  // boot over an index the search rebuilds anyway.
  let indexStatement: ReturnType<SqliteClient["prepare"]> | undefined;

  /** Make a created row findable in the search — same shape as the store. */
  function index(campaignId: string, kind: string, id: string): void {
    try {
      indexStatement ??= client.prepare(
        `insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
         values (?, ?, '', '', ?, ?, ?)`,
      );
      indexStatement.run(id, id, campaignId, kind, id);
    } catch {
      // No FTS table on this database — the row is what matters.
    }
  }

  function entryExists(campaignId: string, table: string, id: string): boolean {
    return (
      client.prepare(`select 1 from ${table} where campaign_id = ? and id = ?`).all(campaignId, id)
        .length > 0
    );
  }

  function ensureUnsortedChapter(campaignId: string): void {
    if (entryExists(campaignId, "chapters", UNSORTED_CHAPTER_ID)) return;
    createChapter.run(campaignId, UNSORTED_CHAPTER_ID, UNSORTED_CHAPTER_TITLE, campaignId);
    index(campaignId, "chapter", UNSORTED_CHAPTER_ID);
  }

  /**
   * The empty entry a reference asks for — the id and nothing else, exactly
   * what the write paths create (`ensureNpcRow`, `ensureLocationRow`). A SCENE
   * also gets the one thing it cannot be without: a chapter, the `unsortiert`
   * one. Its title stays empty and renders as the id, like every other empty
   * entry.
   */
  function createEntry(campaignId: string, kind: EntryKind, id: string): void {
    if (kind === "scene") {
      ensureUnsortedChapter(campaignId);
      client
        .prepare(
          `insert into scenes (campaign_id, id, chapter_id, title, pos)
           values (?, ?, ?, '',
                   coalesce((select max(pos) + 1 from scenes where campaign_id = ?), 0))`,
        )
        .run(campaignId, id, UNSORTED_CHAPTER_ID, campaignId);
    } else {
      client
        .prepare(
          `insert into ${kind === "npc" ? "npcs" : "locations"} (campaign_id, id, name)
           values (?, ?, '')`,
        )
        .run(campaignId, id);
    }
    index(campaignId, kind, id);
    outcome.entriesCreated.push({ campaignId, kind, id });
  }

  /** The holes of one reference column, grouped by the value that has none. */
  function holes(ref: RefColumn): HoleRow[] {
    return client
      .prepare(
        `select r.campaign_id as campaign_id, r.${ref.column} as value, count(*) as n
           from ${ref.table} r
          where r.${ref.column} is not null
            and trim(r.${ref.column}) <> ''
            and not exists (
                  select 1 from ${ref.target} t
                   where t.campaign_id = r.campaign_id and t.id = r.${ref.column})
          group by r.campaign_id, r.${ref.column}
          order by r.campaign_id, r.${ref.column}`,
      )
      .all() as unknown as HoleRow[];
  }

  /** The rows of one reference column whose value names nothing at all. */
  function blanks(ref: RefColumn): CountRow[] {
    return client
      .prepare(
        `select campaign_id, count(*) as n
           from ${ref.table}
          where ${ref.column} is not null and trim(${ref.column}) = ''
          group by campaign_id
          order by campaign_id`,
      )
      .all() as unknown as CountRow[];
  }

  /** Move every row holding `row.value` onto the id it meant. */
  function repoint(ref: RefColumn, row: HoleRow, meant: string): void {
    client
      .prepare(`update ${ref.table} set ${ref.column} = ? where campaign_id = ? and ${ref.column} = ?`)
      .run(meant, row.campaign_id, row.value);
    outcome.repointed.push({
      campaignId: row.campaign_id,
      column: `${ref.table}.${ref.column}`,
      from: row.value,
      to: meant,
      rows: Number(row.n),
    });
  }

  client
    .transaction(() => {
      // 1. Scenes with NO chapter, NULL or blank: into `unsortiert`.
      for (const row of client
        .prepare(
          `select campaign_id, count(*) as n
             from scenes
            where chapter_id is null or trim(chapter_id) = ''
            group by campaign_id
            order by campaign_id`,
        )
        .all() as unknown as CountRow[]) {
        ensureUnsortedChapter(row.campaign_id);
        client
          .prepare(
            `update scenes set chapter_id = ?
              where campaign_id = ? and (chapter_id is null or trim(chapter_id) = '')`,
          )
          .run(UNSORTED_CHAPTER_ID, row.campaign_id);
        outcome.unsorted.push({ campaignId: row.campaign_id, scenes: Number(row.n) });
      }

      // 2. A `chapter_id` that names no chapter: the chapter is the scene's
      //    address, so it is created under its own slug.
      for (const row of holes({ table: "scenes", column: "chapter_id", target: "chapters" })) {
        createChapter.run(row.campaign_id, row.value, row.value, row.campaign_id);
        index(row.campaign_id, "chapter", row.value);
        outcome.chaptersCreated.push({
          campaignId: row.campaign_id,
          chapterId: row.value,
          scenes: Number(row.n),
        });
      }

      // 3. The nullable references.
      for (const ref of OPTIONAL_REFS) {
        if (!hasColumn(client, ref.table, ref.column) || !hasTable(client, ref.target)) continue;
        const cleared = new Map<string, number>();
        const clearBlank = client.prepare(
          `update ${ref.table} set ${ref.column} = null
            where campaign_id = ? and ${ref.column} is not null and trim(${ref.column}) = ''`,
        );
        for (const row of blanks(ref)) {
          clearBlank.run(row.campaign_id);
          cleared.set(row.campaign_id, Number(row.n));
        }
        for (const row of holes(ref)) {
          const meant = unwrapRef(row.value);
          if (ref.creates === false) {
            // A chapter is never created by naming it: the value names the
            // chapter it MEANT when that one exists, and nothing otherwise.
            if (meant !== row.value && entryExists(row.campaign_id, ref.target, meant)) {
              repoint(ref, row, meant);
              continue;
            }
            client
              .prepare(
                `update ${ref.table} set ${ref.column} = null
                  where campaign_id = ? and ${ref.column} = ?`,
              )
              .run(row.campaign_id, row.value);
            cleared.set(row.campaign_id, (cleared.get(row.campaign_id) ?? 0) + Number(row.n));
            continue;
          }
          if (!entryExists(row.campaign_id, ref.target, meant)) {
            createEntry(row.campaign_id, ref.creates, meant);
          }
          if (meant !== row.value) repoint(ref, row, meant);
        }
        for (const [campaignId, rows] of [...cleared].sort(([a], [b]) => cmp(a, b))) {
          outcome.cleared.push({ campaignId, column: `${ref.table}.${ref.column}`, rows });
        }
      }

      // 4. The references that are part of a key: no NULL to fall back on.
      for (const ref of REQUIRED_REFS) {
        if (!hasColumn(client, ref.table, ref.column) || !hasTable(client, ref.target)) continue;
        const dropBlank = client.prepare(
          `delete from ${ref.table}
            where campaign_id = ? and ${ref.column} is not null and trim(${ref.column}) = ''`,
        );
        for (const row of blanks(ref)) {
          dropBlank.run(row.campaign_id);
          outcome.dropped.push({
            campaignId: row.campaign_id,
            table: ref.table,
            rows: Number(row.n),
          });
        }
        for (const row of holes(ref)) {
          const meant = unwrapRef(row.value);
          if (!entryExists(row.campaign_id, ref.target, meant)) {
            createEntry(row.campaign_id, KIND_OF_TARGET[ref.target] ?? "npc", meant);
          }
          if (meant === row.value) continue;
          // The row the re-pointing would DUPLICATE goes first: the reference
          // is part of the key, so a parent that names both spellings would
          // otherwise end up with the same entry twice.
          const sameParent = ref.keyColumns
            .map((column) => `${column} = r.${column}`)
            .join(" and ");
          client
            .prepare(
              `delete from ${ref.table} as r
                where r.campaign_id = ? and r.${ref.column} = ?
                  and exists (select 1 from ${ref.table}
                               where campaign_id = r.campaign_id
                                 and ${ref.column} = ? and ${sameParent})`,
            )
            .run(row.campaign_id, row.value, meant);
          repoint(ref, row, meant);
        }
      }
    })
    .immediate();

  const changes =
    outcome.chaptersCreated.length +
    outcome.unsorted.length +
    outcome.entriesCreated.length +
    outcome.repointed.length +
    outcome.cleared.length +
    outcome.dropped.length;
  return changes === 0 ? NO_REFERENCE_REPAIR : outcome;
}
