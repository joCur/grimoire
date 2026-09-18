// The gate in front of the session timestamps.
//
// `sessions.started`, `sessions.ended` and both ends of a `session_pauses` row
// have ONE shape, `yyyy-mm-ddTHH:MM:SS` (store/time.ts), and the reader gives
// anything else no reading at all. That is safe as long as the stored data
// really is in that shape — so it is checked here instead of being guessed at
// row by row: a session whose `started` a direct database write left in some
// other spelling would otherwise silently lose its place in the campaign's
// chronology and its runtime.
//
// DELIBERATELY NO REPAIR, the same stance as the reference and status gates
// (ADR #19, #25). What `19:30` on an unknown day, or a value in a foreign
// notation, was meant to be is a reading only the DM can supply, and picking
// one for them would change recorded history. The report names campaign,
// session, column and value — enough to correct the row and start again.
//
// It runs on the raw client next to its siblings, before the store layer may
// look at the database, and skips a database that has no session tables yet
// (a database on its very first boot).

import type { SqliteClient } from "./driver";
import { LOCAL_DATE_TIME_SECONDS, localDateTimeToMs } from "../store/time";

/** One stored timestamp the reader would not be able to read. */
export interface TimestampProblem {
  /** The campaign the row belongs to. */
  campaign: string;
  /** The session's id — its address is `sessions/<id>`. */
  session: string;
  /** The column, as the schema spells it: `started`, `ended`, `from_ts`, `to_ts`. */
  column: string;
  /** The stored value, verbatim. */
  value: string;
}

/** One column to check and where its rows live. */
interface TimestampColumn {
  table: string;
  column: string;
  /** The column holding the session id — `id` on the session itself. */
  sessionColumn: string;
}

/**
 * Every column holding a session timestamp. All four may also hold nothing:
 * a session that is still running has no `ended`, an open pause no `to_ts`,
 * and an empty value is "not set" to the reader as well.
 */
const TIMESTAMP_COLUMNS: readonly TimestampColumn[] = [
  { table: "sessions", column: "started", sessionColumn: "id" },
  { table: "sessions", column: "ended", sessionColumn: "id" },
  { table: "session_pauses", column: "from_ts", sessionColumn: "session_id" },
  { table: "session_pauses", column: "to_ts", sessionColumn: "session_id" },
];

function hasTable(client: SqliteClient, name: string): boolean {
  return (
    client
      .prepare("select name from sqlite_master where type = 'table' and name = ?")
      .all(name).length > 0
  );
}

interface StoredTimestamp {
  campaign: string;
  session: string;
  value: string;
}

/** Every non-empty value of one column, with the row it sits on. */
function storedValues(client: SqliteClient, column: TimestampColumn): StoredTimestamp[] {
  return client
    .prepare(
      `select campaign_id as campaign, \`${column.sessionColumn}\` as session,` +
        ` \`${column.column}\` as value from \`${column.table}\`` +
        ` where \`${column.column}\` is not null and trim(\`${column.column}\`) <> ''` +
        ` order by campaign_id, \`${column.sessionColumn}\``,
    )
    .all() as unknown as StoredTimestamp[];
}

/**
 * Every stored session timestamp outside the one shape. The check IS the
 * reader (store/time.ts), not a second spelling of the format, so the gate and
 * the reader can never drift apart.
 */
export function findTimestampProblems(client: SqliteClient): TimestampProblem[] {
  const problems: TimestampProblem[] = [];
  for (const column of TIMESTAMP_COLUMNS) {
    if (!hasTable(client, column.table)) continue;
    for (const row of storedValues(client, column)) {
      if (localDateTimeToMs(row.value) !== undefined) continue;
      problems.push({
        campaign: row.campaign,
        session: row.session,
        column: column.column,
        value: row.value,
      });
    }
  }
  return problems;
}

/** The log block a failed check prints — one line per offending value. */
export function timestampProblemReport(problems: TimestampProblem[]): string[] {
  const lines = [
    "Timestamp check failed — these session values are not in the one shape" +
      ` ${LOCAL_DATE_TIME_SECONDS.replace(/'/g, "")}:`,
  ];
  for (const problem of problems) {
    lines.push(
      `  · ${problem.campaign} sessions/${problem.session}: ${problem.column} =` +
        ` ${JSON.stringify(problem.value)}`,
    );
  }
  lines.push(
    "Correct these values directly in the database, then start again. Nothing" +
      " has been changed.",
  );
  return lines;
}

/**
 * Abort the start when a stored session timestamp is outside the one shape.
 * The report goes to the log BEFORE the throw, so the operator reads all of it
 * even where only the last line of an error survives.
 */
export function assertTimestampsReady(client: SqliteClient): void {
  const problems = findTimestampProblems(client);
  if (problems.length === 0) return;
  const report = timestampProblemReport(problems);
  for (const line of report) console.error(line);
  throw new Error(report.join("\n"));
}
