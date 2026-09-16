// The gate in front of the reference constraints (migration 0014).
//
// That migration turns every stored reference into a real foreign key and
// makes a scene's chapter mandatory. A database whose data cannot satisfy
// that would fail somewhere in the middle of the rebuild with SQLite's own
// "FOREIGN KEY constraint failed" — a message that names neither the table,
// nor the column, nor the value that is wrong.
//
// So the migration path asks FIRST, while the old schema is still in place:
// is every reference resolvable? If not, nothing is migrated at all, and the
// log says per table and column which values name no entry and how many
// carry them. The data is then corrected in the previous version of the app
// or directly in the database, and the next start migrates.
//
// DELIBERATELY NO REPAIR. Creating the missing entries would invent content,
// and dropping the references would delete what somebody wrote — both are
// decisions only the DM can make.
//
// It runs on the raw client before the migrator, like the other
// pre-migration step next to it, and is guarded by the constraints' own
// absence: once the foreign keys are there, there is nothing left to check.

import type { SqliteClient } from "./driver";

/** One reference that cannot become a foreign key, per table and column. */
export interface ReferenceProblem {
  /** The table holding the reference. */
  table: string;
  /** The column holding it. */
  column: string;
  /** The table it has to point at; "" when the value is simply absent. */
  target: string;
  /** How many rows carry an offending value. */
  rows: number;
  /**
   * The offending values as `<campaign>/<value>`, de-duplicated and sorted.
   * Empty when the problem is a MISSING value.
   */
  values: string[];
}

/** How many distinct values one problem lists before it only counts them. */
const MAX_VALUES = 20;

/** One reference to check: a column and the table it has to resolve in. */
interface Reference {
  table: string;
  column: string;
  target: string;
  /** True when the column may hold nothing — a null is then no problem. */
  nullable: boolean;
}

/**
 * Every reference the migration constrains. `generate_jobs.chapter` is not
 * among them on purpose: a run for a new chapter names the chapter it is
 * going to create.
 */
const REFERENCES: readonly Reference[] = [
  { table: "scenes", column: "chapter_id", target: "chapters", nullable: false },
  { table: "scenes", column: "location", target: "locations", nullable: true },
  { table: "scene_npcs", column: "npc_id", target: "npcs", nullable: false },
  { table: "npcs", column: "chapter_id", target: "chapters", nullable: true },
  { table: "locations", column: "chapter_id", target: "chapters", nullable: true },
  { table: "log_entries", column: "scene_id", target: "scenes", nullable: true },
  { table: "session_scenes_played", column: "scene_id", target: "scenes", nullable: true },
];

function hasTable(client: SqliteClient, name: string): boolean {
  return (
    client
      .prepare("select name from sqlite_master where type = 'table' and name = ?")
      .all(name).length > 0
  );
}

/**
 * Are the constraints still missing? Asked of `scenes`, the table that gets
 * two of them — a database that already carries the chapter foreign key has
 * been through the migration and has nothing left to check.
 */
function constraintsMissing(client: SqliteClient): boolean {
  if (!hasTable(client, "scenes")) return false;
  const rows = client.prepare("pragma foreign_key_list(scenes)").all() as unknown as Array<{
    table: string;
  }>;
  return !rows.some((row) => row.table === "chapters");
}

interface CountedValue {
  value: string;
  rows: number;
}

/**
 * Values of `column` that have no counterpart in `target`, per campaign. A
 * row that holds NOTHING is never one of them: for a nullable reference that
 * is legal, and for a mandatory one `absentCount` reports it — the same row
 * must not appear twice under two different reasons.
 */
function unresolved(client: SqliteClient, reference: Reference): CountedValue[] {
  const { table, column, target } = reference;
  return client
    .prepare(
      `select child.campaign_id || '/' || child.\`${column}\` as value,` +
        ` count(*) as rows from \`${table}\` as child` +
        ` where child.\`${column}\` is not null` +
        ` and not exists (select 1 from \`${target}\` as parent` +
        ` where parent.campaign_id = child.campaign_id and parent.id = child.\`${column}\`)` +
        ` group by value order by value`,
    )
    .all() as unknown as CountedValue[];
}

/** Rows whose reference is not set at all — only asked where it must be. */
function absentCount(client: SqliteClient, reference: Reference): number {
  const row = client
    .prepare(
      `select count(*) as rows from \`${reference.table}\` where \`${reference.column}\` is null`,
    )
    .all()[0] as unknown as { rows: number } | undefined;
  return row?.rows ?? 0;
}

/**
 * Every reference in the database that cannot become a foreign key. Empty for
 * a database that is ready — and for one that is already migrated.
 */
export function findReferenceProblems(client: SqliteClient): ReferenceProblem[] {
  if (!constraintsMissing(client)) return [];
  const problems: ReferenceProblem[] = [];
  for (const reference of REFERENCES) {
    if (!hasTable(client, reference.table) || !hasTable(client, reference.target)) continue;
    if (!reference.nullable) {
      const absent = absentCount(client, reference);
      if (absent > 0) {
        problems.push({
          table: reference.table,
          column: reference.column,
          target: "",
          rows: absent,
          values: [],
        });
      }
    }
    const dangling = unresolved(client, reference);
    if (dangling.length === 0) continue;
    problems.push({
      table: reference.table,
      column: reference.column,
      target: reference.target,
      rows: dangling.reduce((sum, entry) => sum + entry.rows, 0),
      values: dangling.map((entry) => entry.value),
    });
  }
  return problems;
}

/** „1 entry names" / „3 entries name" — so the lines below read as sentences. */
function entriesName(count: number): string {
  return count === 1 ? "1 entry names" : `${count} entries name`;
}

/** The log block a failed check prints — one line per table and column. */
export function referenceProblemReport(problems: ReferenceProblem[]): string[] {
  const lines = ["Reference check failed — this data cannot get the reference constraints yet:"];
  for (const problem of problems) {
    const where = `${problem.table}.${problem.column}`;
    if (problem.target === "") {
      lines.push(
        `  · ${where}: ${entriesName(problem.rows)} nothing at all,` +
          " and the reference is mandatory",
      );
      continue;
    }
    const shown = problem.values.slice(0, MAX_VALUES).join(", ");
    const rest = problem.values.length - MAX_VALUES;
    lines.push(
      `  · ${where} -> ${problem.target}: ${entriesName(problem.rows)} something that does` +
        ` not exist: ${shown}${rest > 0 ? `, and ${rest} more` : ""}`,
    );
  }
  lines.push(
    "Correct this data in the previous version of the app or directly in the database," +
      " then start again. Nothing has been migrated.",
  );
  return lines;
}

/**
 * Run the check and abort the start when it fails. The report goes to the log
 * BEFORE the throw, so the operator reads all of it even where only the last
 * line of an error survives.
 */
export function assertReferencesResolvable(client: SqliteClient): void {
  const problems = findReferenceProblems(client);
  if (problems.length === 0) return;
  const report = referenceProblemReport(problems);
  for (const line of report) console.error(line);
  throw new Error(report.join("\n"));
}
