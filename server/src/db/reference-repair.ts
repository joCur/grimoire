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
// AND NO ENTRY EVER GETS AN ID THAT IS PROSE. The columns also hold plain
// text: `npcs: [Alte Fischerin]`, a relation line whose counterpart is a
// name, a scene whose `location` is „Der alte Hafen“. Creating the entry the
// value literally names would satisfy the constraint the same way the
// brackets did and be wrong the same way — an entry whose id is a sentence,
// in every address built from it, in every ⌘K result. So the text is READ
// the way the product reads every typed name: `toSlug` gives the id, and the
// text becomes the entry's display NAME. That is what the properties form
// does with a typed Ort, and what the group step (db/group-migration.ts)
// already does with a free-text `location` — the two steps see the same
// column and have to answer the same input the same way, or a boot would
// undo what that step decided.
//
//   * `scenes.location`, `scene_npcs.npc_id`, `npc_relations.other_npc_id`,
//     `session_scenes_played.scene_id` → the entry is CREATED, under the slug
//     of the text and with the text as its name. The reference survives, the
//     name survives, and the id is an id.
//   * `log_entries.scene_id` → NULL, and the text in the boot report. A log
//     line is not an ADDRESS: the marker in it is a note about what the table
//     was talking about, the line keeps it in `raw`, and creating a scene for
//     it would put a scene nobody played into the chapter overview.
//
// A text nothing usable survives the transliteration of („???“) yields no id
// at all. There the value becomes NULL where the column allows it — with the
// text in the report, since that is all anybody has left of it — and the row
// goes where the reference is part of the key.
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

import { ENTITY_SLUG, toSlug } from "@grimoire/shared";
import type { SqliteClient } from "./driver";

/** The chapter that takes in scenes which name none. */
export const UNSORTED_CHAPTER_ID = "unsortiert";
export const UNSORTED_CHAPTER_TITLE = "Unsortiert";

/** One chapter row this step had to create, and for how many scenes. */
export interface ChapterCreated {
  campaignId: string;
  /** The chapter id the scenes named — and, absent `fromText`, its title. */
  chapterId: string;
  /** How many scenes were hanging under it. */
  scenes: number;
  /** The free text the id was derived from, when it was not an id itself. */
  fromText?: string;
}

/** One campaign whose chapterless scenes were moved into `unsortiert`. */
export interface ScenesUnsorted {
  campaignId: string;
  /** How many scenes had no chapter at all. */
  scenes: number;
  /** Did the chapter have to be created, or was one already there? */
  chapterCreated: boolean;
}

/** One empty entry created for a reference that named no row. */
export interface EntryCreated {
  campaignId: string;
  kind: EntryKind;
  id: string;
  /**
   * The free text the id was derived from, when the stored value was no id —
   * it is the entry's display name, and the boot report names it, because an
   * entry the DM never authored is something to read rather than discover.
   */
  fromText?: string;
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

/**
 * One optional reference that held FREE TEXT and could not become an entry —
 * NULL now, with the text in the report. Its own category, not lumped in with
 * `cleared`: „the field was empty“ needs no words, „the field said Abkürzung
 * übers Moor and says nothing now“ is the only copy of that text left.
 */
export interface ReferenceTextCleared {
  campaignId: string;
  column: string;
  /** The text that stood in the column. */
  value: string;
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
  /** Optional references that held free text and are NULL now. */
  clearedText: ReferenceTextCleared[];
  /** Reference rows that named nothing and were dropped. */
  dropped: ReferenceDropped[];
}

export const NO_REFERENCE_REPAIR: ReferenceRepairOutcome = {
  chaptersCreated: [],
  unsorted: [],
  entriesCreated: [],
  repointed: [],
  cleared: [],
  clearedText: [],
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
 *
 * `fromText` says what FREE TEXT in the column means. `"create"` makes the
 * entry under the slug of the text, with the text as its name — the answer
 * for a column that holds an ADDRESS. `"clear"` empties the column and puts
 * the text in the boot report instead; see the header for why a log line's
 * scene is the one reference read that way.
 */
interface OptionalRef extends RefColumn {
  creates: EntryKind | false;
  fromText: "create" | "clear";
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
  {
    table: "scenes",
    column: "location",
    target: "locations",
    creates: "location",
    fromText: "create",
  },
  {
    table: "npcs",
    column: "chapter_id",
    target: "chapters",
    creates: false,
    fromText: "clear",
  },
  {
    table: "locations",
    column: "chapter_id",
    target: "chapters",
    creates: false,
    fromText: "clear",
  },
  {
    table: "log_entries",
    column: "scene_id",
    target: "scenes",
    creates: "scene",
    fromText: "clear",
  },
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
 * What a stored value can be READ as: the id it names, and the text it is
 * when it names none.
 *
 * `id` is "" for a text nothing usable survives the transliteration of — an
 * id is never invented out of nothing (`toSlug`'s own rule). `text` is set
 * only when the value was NOT an id, and it is then the display name the
 * created entry gets; see the header for which columns may create one.
 */
function referenceValue(value: string): { id: string; text: string } {
  const unwrapped = unwrapRef(value).trim();
  if (ENTITY_SLUG.test(unwrapped)) return { id: unwrapped, text: "" };
  return { id: toSlug(unwrapped), text: unwrapped };
}

/**
 * What `pragma foreign_key_check` finds, per table — LOGGED, not returned.
 *
 * A violation of a constraint a database ALREADY carries is not this step's
 * business: it closes the holes the old unconstrained schema allowed, and the
 * migrator then rebuilds the tables. But if such a row is there, the rebuild
 * fails on a copy statement — and all a boot used to say was that a migration
 * had failed, with no hint which row it choked on. Naming the tables
 * beforehand turns that into a diagnosis.
 *
 * It prints rather than reporting through `OpenDb` for exactly that reason:
 * the interesting case is the boot that does not get far enough to return
 * anything. Silent on a clean database, which is every database this server
 * writes, and silent on one the migrator has not built yet.
 */
export function reportForeignKeyViolations(client: SqliteClient): void {
  let violations: Record<string, unknown>[];
  try {
    violations = client.prepare("pragma foreign_key_check").all();
  } catch {
    return;
  }
  if (violations.length === 0) return;
  const perTable = new Map<string, number>();
  for (const violation of violations) {
    const table = String(violation.table ?? "?");
    perTable.set(table, (perTable.get(table) ?? 0) + 1);
  }
  console.log(
    `${violations.length} row(s) already break a foreign key this database ` +
      "carries — the table rebuilds of the migration will fail on them:",
  );
  for (const [table, rows] of [...perTable].sort(([a], [b]) => cmp(a, b))) {
    console.log(`  · ${table}: ${rows} row(s)`);
  }
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
    clearedText: [],
    dropped: [],
  };

  const createChapter = client.prepare(
    // `title = id` for a chapter named by a slug — that slug is the only name
    // anybody has for it, and the DM renames it in the overview. When the
    // value was TEXT the text is the title, because then a name does exist.
    // `pos` puts the chapter LAST in its campaign, which is where an unplaced
    // chapter belongs; any other choice would push the known chapters around.
    `insert into chapters (campaign_id, id, title, status, body, extra, pos, rev)
     values (?, ?, ?, 'planned', '', '{}',
             coalesce((select max(pos) + 1 from chapters where campaign_id = ?), 0), 1)`,
  );
  // Prepared on first use: a database whose virtual FTS table was never
  // created (the smoke tests build their tables by hand) must not fail the
  // boot over an index the search rebuilds anyway.
  let indexStatement: ReturnType<SqliteClient["prepare"]> | undefined;

  /**
   * Make a created row findable in the search — same shape as the store.
   * `title` is what ⌘K shows, so an entry created from free text is found by
   * that text and not only by the slug derived from it.
   */
  function index(campaignId: string, kind: string, id: string, title = id): void {
    try {
      indexStatement ??= client.prepare(
        `insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
         values (?, ?, '', '', ?, ?, ?)`,
      );
      indexStatement.run(title, id, campaignId, kind, id);
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

  /** True when the chapter had to be created, false when one was there. */
  function ensureUnsortedChapter(campaignId: string): boolean {
    if (entryExists(campaignId, "chapters", UNSORTED_CHAPTER_ID)) return false;
    createChapter.run(campaignId, UNSORTED_CHAPTER_ID, UNSORTED_CHAPTER_TITLE, campaignId);
    index(campaignId, "chapter", UNSORTED_CHAPTER_ID, UNSORTED_CHAPTER_TITLE);
    return true;
  }

  /**
   * The empty entry a reference asks for — the id and nothing else, exactly
   * what the write paths create (`ensureNpcRow`, `ensureLocationRow`). A SCENE
   * also gets the one thing it cannot be without: a chapter, the `unsortiert`
   * one.
   *
   * `name` is the free text the id was derived from, and only then: an entry
   * whose name repeats its id says nothing, and render.ts falls back to the id
   * anyway. With a name the entry is the text the DM wrote, under an id that
   * is an id — the only shape in which a reference written as prose can be
   * kept at all (see the header).
   */
  function createEntry(campaignId: string, kind: EntryKind, id: string, name = ""): void {
    if (kind === "scene") {
      ensureUnsortedChapter(campaignId);
      client
        .prepare(
          `insert into scenes (campaign_id, id, chapter_id, title, pos)
           values (?, ?, ?, ?,
                   coalesce((select max(pos) + 1 from scenes where campaign_id = ?), 0))`,
        )
        .run(campaignId, id, UNSORTED_CHAPTER_ID, name, campaignId);
    } else {
      client
        .prepare(
          `insert into ${kind === "npc" ? "npcs" : "locations"} (campaign_id, id, name)
           values (?, ?, ?)`,
        )
        .run(campaignId, id, name);
    }
    index(campaignId, kind, id, name === "" ? id : name);
    outcome.entriesCreated.push(
      name === "" ? { campaignId, kind, id } : { campaignId, kind, id, fromText: name },
    );
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

  /**
   * Move every row holding `row.value` onto the id it meant, and report how
   * many actually moved.
   *
   * `rows` is passed rather than taken from `row.n`: on a key column some of
   * those rows are deleted first as duplicates of the row the re-pointing
   * would collide with, and counting them as re-pointed made the boot report
   * claim work it had undone in the same breath.
   */
  function repoint(ref: RefColumn, row: HoleRow, meant: string, rows: number): void {
    client
      .prepare(`update ${ref.table} set ${ref.column} = ? where campaign_id = ? and ${ref.column} = ?`)
      .run(meant, row.campaign_id, row.value);
    outcome.repointed.push({
      campaignId: row.campaign_id,
      column: `${ref.table}.${ref.column}`,
      from: row.value,
      to: meant,
      rows,
    });
  }

  /** Report rows this step had to delete, because nothing could keep them. */
  function reportDropped(campaignId: string, table: string, rows: number): void {
    if (rows > 0) outcome.dropped.push({ campaignId, table, rows });
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
        const chapterCreated = ensureUnsortedChapter(row.campaign_id);
        client
          .prepare(
            `update scenes set chapter_id = ?
              where campaign_id = ? and (chapter_id is null or trim(chapter_id) = '')`,
          )
          .run(UNSORTED_CHAPTER_ID, row.campaign_id);
        outcome.unsorted.push({
          campaignId: row.campaign_id,
          scenes: Number(row.n),
          chapterCreated,
        });
      }

      // 2. A `chapter_id` that names no chapter. The chapter is the scene's
      //    ADDRESS, so unlike a grouping note it IS created — but the value
      //    is read first, like every other reference: a stored
      //    `[[03-x]]` names the chapter `03-x` (and gets re-pointed at it
      //    instead of adding a second one next to it), and text becomes an id
      //    with the text as the chapter's title. A chapter whose id is a
      //    sentence would carry that sentence in the address of every scene
      //    under it.
      const sceneChapter: RefColumn = {
        table: "scenes",
        column: "chapter_id",
        target: "chapters",
      };
      for (const row of holes(sceneChapter)) {
        const meant = referenceValue(row.value);
        // NOT NULL and part of the address: without an id there is nothing to
        // point the scene at but the chapter that exists for exactly this.
        const chapterId = meant.id === "" ? UNSORTED_CHAPTER_ID : meant.id;
        if (chapterId === UNSORTED_CHAPTER_ID) {
          const chapterCreated = ensureUnsortedChapter(row.campaign_id);
          outcome.unsorted.push({
            campaignId: row.campaign_id,
            scenes: Number(row.n),
            chapterCreated,
          });
        } else if (!entryExists(row.campaign_id, "chapters", chapterId)) {
          const title = meant.text === "" ? chapterId : meant.text;
          createChapter.run(row.campaign_id, chapterId, title, row.campaign_id);
          index(row.campaign_id, "chapter", chapterId, title);
          outcome.chaptersCreated.push(
            meant.text === ""
              ? { campaignId: row.campaign_id, chapterId, scenes: Number(row.n) }
              : {
                  campaignId: row.campaign_id,
                  chapterId,
                  scenes: Number(row.n),
                  fromText: meant.text,
                },
          );
        }
        if (chapterId !== row.value) {
          repoint(sceneChapter, row, chapterId, Number(row.n));
        }
      }

      // 3. The nullable references.
      for (const ref of OPTIONAL_REFS) {
        if (!hasColumn(client, ref.table, ref.column) || !hasTable(client, ref.target)) continue;
        const cleared = new Map<string, number>();
        const clearBlank = client.prepare(
          `update ${ref.table} set ${ref.column} = null
            where campaign_id = ? and ${ref.column} is not null and trim(${ref.column}) = ''`,
        );
        const clearValue = client.prepare(
          `update ${ref.table} set ${ref.column} = null
            where campaign_id = ? and ${ref.column} = ?`,
        );
        for (const row of blanks(ref)) {
          clearBlank.run(row.campaign_id);
          cleared.set(row.campaign_id, Number(row.n));
        }
        for (const row of holes(ref)) {
          if (ref.creates === false) {
            // A chapter is never created by naming it: the value names the
            // chapter it MEANT when that one exists, and nothing otherwise.
            // Only the brackets are read here — deriving a chapter from prose
            // and hoping it hits one would be a guess, not an unwrapping.
            const unwrapped = unwrapRef(row.value);
            if (
              unwrapped !== row.value &&
              entryExists(row.campaign_id, ref.target, unwrapped)
            ) {
              repoint(ref, row, unwrapped, Number(row.n));
              continue;
            }
            clearValue.run(row.campaign_id, row.value);
            cleared.set(row.campaign_id, (cleared.get(row.campaign_id) ?? 0) + Number(row.n));
            continue;
          }
          const meant = referenceValue(row.value);
          if (meant.text !== "" && (ref.fromText === "clear" || meant.id === "")) {
            // FREE TEXT this column cannot turn into an entry: either it holds
            // no address (a log line's scene, see the header), or the text
            // yields no slug at all and an id is never invented out of
            // nothing. The column may be NULL, so it becomes NULL — and the
            // TEXT goes into the report, which is then the only place it
            // still stands.
            clearValue.run(row.campaign_id, row.value);
            outcome.clearedText.push({
              campaignId: row.campaign_id,
              column: `${ref.table}.${ref.column}`,
              value: row.value,
              rows: Number(row.n),
            });
            continue;
          }
          if (!entryExists(row.campaign_id, ref.target, meant.id)) {
            // `meant.text` is set only when the value was no id, and it is
            // then the entry's display name — the same shape the key columns
            // and the group step give a reference written as prose.
            createEntry(row.campaign_id, ref.creates, meant.id, meant.text);
          }
          if (meant.id !== row.value) repoint(ref, row, meant.id, Number(row.n));
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
        const dropValue = client.prepare(
          `delete from ${ref.table} where campaign_id = ? and ${ref.column} = ?`,
        );
        for (const row of blanks(ref)) {
          dropBlank.run(row.campaign_id);
          reportDropped(row.campaign_id, ref.table, Number(row.n));
        }
        // The row the re-pointing would DUPLICATE goes first: the reference is
        // part of the key, so a parent that names both spellings would
        // otherwise end up with the same entry twice.
        const sameParent = ref.keyColumns.map((column) => `${column} = r.${column}`).join(" and ");
        const dropDuplicate = client.prepare(
          `delete from ${ref.table} as r
            where r.campaign_id = ? and r.${ref.column} = ?
              and exists (select 1 from ${ref.table}
                           where campaign_id = r.campaign_id
                             and ${ref.column} = ? and ${sameParent})`,
        );
        for (const row of holes(ref)) {
          const meant = referenceValue(row.value);
          if (meant.id === "") {
            // Free text nothing usable survives the transliteration of, in a
            // column that has no NULL: there is no id to create and no id to
            // keep, so the row goes the way a reference that named nothing
            // does — and the report says so.
            reportDropped(
              row.campaign_id,
              ref.table,
              Number(dropValue.run(row.campaign_id, row.value).changes),
            );
            continue;
          }
          if (!entryExists(row.campaign_id, ref.target, meant.id)) {
            // TEXT becomes an entry here, unlike in the nullable columns: the
            // reference is part of the key, so there is no NULL to fall back
            // on and dropping the row would drop the note with it. It gets an
            // id derived from the text, and the text as its name.
            createEntry(row.campaign_id, KIND_OF_TARGET[ref.target] ?? "npc", meant.id, meant.text);
          }
          if (meant.id === row.value) continue;
          const duplicates = Number(
            dropDuplicate.run(row.campaign_id, row.value, meant.id).changes,
          );
          reportDropped(row.campaign_id, ref.table, duplicates);
          // What is LEFT is what gets re-pointed — the duplicates are gone.
          const moved = Number(row.n) - duplicates;
          if (moved > 0) repoint(ref, row, meant.id, moved);
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
    outcome.clearedText.length +
    outcome.dropped.length;
  return changes === 0 ? NO_REFERENCE_REPAIR : outcome;
}
