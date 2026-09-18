// The gate in front of the CHECK constraints (migration 0016, ADR #25).
//
// That migration closes four columns — `scenes.status`, `scenes.type`,
// `npcs.status`, `chapters.status` — against the value lists in
// @grimoire/shared. A database holding something else would fail somewhere in
// the middle of the rebuild with SQLite's own "CHECK constraint failed", a
// message that names neither the row nor the value that is wrong.
//
// So the migration path asks FIRST, while the old columns are still open, and
// the report names campaign, ADDRESS and value — the three things the DM needs
// to open the entry and correct it.
//
// DELIBERATELY NO REPAIR. Which of the four positions a foreign value was
// meant to be is a decision only the DM can make, and picking one for them
// would change authored content behind their back.
//
// It runs on the raw client before the migrator, next to the reference
// pre-flight, and is guarded by the constraints' own absence: once the CHECKs
// are there, there is nothing left to check.

import { CHAPTER_STATUSES, NPC_STATUSES, SCENE_STATUSES, SCENE_TYPES } from "@grimoire/shared";
import type { SqliteClient } from "./driver";

/** One stored value a CHECK constraint would refuse. */
export interface StatusProblem {
  /** The campaign the row belongs to. */
  campaign: string;
  /** The entry's ADDRESS, as `GET /entries/<address>` spells it. */
  address: string;
  /** `status` or `type` — the field the DM edits. */
  field: string;
  /** The stored value, verbatim. */
  value: string;
  /** What the column accepts, in order. */
  allowed: readonly string[];
}

/** One column to check, and the address its rows are shown under. */
interface ClosedColumn {
  table: string;
  column: string;
  /** The property name the DM sees — not the column name. */
  field: string;
  allowed: readonly string[];
  /** True when the column may hold nothing, which is then no problem. */
  nullable: boolean;
}

/**
 * Every column migration 0016 closes. The allowed values are the SHARED lists
 * and are not repeated here — the same lists the schema builds the constraints
 * from, so the gate and the constraint can never drift apart.
 */
const CLOSED_COLUMNS: readonly ClosedColumn[] = [
  {
    table: "chapters",
    column: "status",
    field: "status",
    allowed: CHAPTER_STATUSES,
    nullable: true,
  },
  { table: "scenes", column: "status", field: "status", allowed: SCENE_STATUSES, nullable: false },
  { table: "scenes", column: "type", field: "type", allowed: SCENE_TYPES, nullable: false },
  { table: "npcs", column: "status", field: "status", allowed: NPC_STATUSES, nullable: false },
];

function hasTable(client: SqliteClient, name: string): boolean {
  return (
    client
      .prepare("select name from sqlite_master where type = 'table' and name = ?")
      .all(name).length > 0
  );
}

/**
 * Are the constraints still missing? Read off the stored CREATE TABLE text of
 * `scenes`, which gets two of them — a database that already carries them has
 * been through the migration and has nothing left to check.
 */
function checksMissing(client: SqliteClient): boolean {
  if (!hasTable(client, "scenes")) return false;
  const rows = client
    .prepare("select sql from sqlite_master where type = 'table' and name = 'scenes'")
    .all() as unknown as Array<{ sql: string | null }>;
  const definition = rows[0]?.sql ?? "";
  return !definition.includes("scenes_status_check");
}

interface OffendingRow {
  campaign: string;
  id: string;
  chapter_id: string | null;
  location: string | null;
  value: string;
}

/**
 * The ADDRESS of one offending row. A scene's is `<chapter>/<location>/<id>`
 * with the location segment left out when it has none (store/paths.ts is the
 * schema); the other two kinds are addressed by their own id. Spelled here
 * rather than imported: this module runs against the OLD schema, before the
 * store layer may look at the database at all.
 */
function addressOf(table: string, row: OffendingRow): string {
  if (table === "npcs") return `npcs/${row.id}`;
  if (table === "chapters") return row.id;
  const group = row.location === null || row.location === "" ? "" : `${row.location}/`;
  return `${row.chapter_id ?? ""}/${group}${row.id}`;
}

/** Rows of one column whose value is outside the allowed list. */
function offendingRows(client: SqliteClient, column: ClosedColumn): OffendingRow[] {
  const { table, allowed, nullable } = column;
  const placeholders = allowed.map(() => "?").join(", ");
  // `chapter_id` and `location` only exist on `scenes`; selecting them as
  // constants elsewhere keeps ONE query shape for all four columns.
  const addressColumns =
    table === "scenes" ? "`chapter_id` as chapter_id, `location` as location" : "null, null";
  const nullArm = nullable ? `\`${column.column}\` is not null and ` : "";
  return client
    .prepare(
      `select campaign_id as campaign, id, ${addressColumns},` +
        ` \`${column.column}\` as value from \`${table}\`` +
        ` where ${nullArm}\`${column.column}\` not in (${placeholders})` +
        " order by campaign_id, id",
    )
    .all(...allowed) as unknown as OffendingRow[];
}

/**
 * Every stored value the CHECK constraints would refuse. Empty for a database
 * that is ready — and for one that is already migrated.
 */
export function findStatusProblems(client: SqliteClient): StatusProblem[] {
  if (!checksMissing(client)) return [];
  const problems: StatusProblem[] = [];
  for (const column of CLOSED_COLUMNS) {
    if (!hasTable(client, column.table)) continue;
    for (const row of offendingRows(client, column)) {
      problems.push({
        campaign: row.campaign,
        address: addressOf(column.table, row),
        field: column.field,
        value: row.value,
        allowed: column.allowed,
      });
    }
  }
  return problems;
}

/** The log block a failed check prints — one line per offending entry. */
export function statusProblemReport(problems: StatusProblem[]): string[] {
  const lines = [
    "Status check failed — these entries carry a value the column will not" +
      " accept any more:",
  ];
  for (const problem of problems) {
    lines.push(
      `  · ${problem.campaign} ${problem.address}: ${problem.field} =` +
        ` ${JSON.stringify(problem.value)} — one of ${problem.allowed.join(", ")}`,
    );
  }
  lines.push(
    "Correct these entries in the previous version of the app or directly in" +
      " the database, then start again. Nothing has been migrated.",
  );
  return lines;
}

/**
 * Abort the start when a stored status or type is outside its list. The report
 * goes to the log BEFORE the throw, so the operator reads all of it even where
 * only the last line of an error survives.
 */
export function assertStatusesReady(client: SqliteClient): void {
  const problems = findStatusProblems(client);
  if (problems.length === 0) return;
  const report = statusProblemReport(problems);
  for (const line of report) console.error(line);
  throw new Error(report.join("\n"));
}
