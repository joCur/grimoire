// The gate in front of the log and inbox rows.
//
// A session's log and the campaign inbox are TABLES the API answers as rows
// (ADR #26), and `text` is the content of a row. Until migration 0018 the row
// also held `raw`, the markdown line it was written as, and `text` was the
// parse of that line — NULL whenever the parse found nothing. Those rows
// cannot become notes: there is no way to tell what the line was meant to be
// without reading it.
//
// So they are checked here, BEFORE the migrator, and the start is REFUSED.
// The migration drops `raw`, and a row that arrived there with no text would
// silently turn into an empty note — an idea with no words in the inbox, a
// log line the review shows as a blank.
//
// DELIBERATELY NO REPAIR, the same stance as the reference, status and
// timestamp gates (ADR #19, #25). What a hand-typed line was is a reading only
// the DM can supply. The report names campaign, list, position and the line
// verbatim — enough to correct the row, or to delete it, and start again.
//
// TWO KINDS OF ROW ARE FINE and are not reported, because the migration
// deletes them and loses nothing in doing so:
//
//   * an inbox HEADING (`# Inbox`, `## Eingang`) — the title of a text that no
//     longer exists, never an idea;
//   * a log PAUSE MARKER (`— Pause`, `— Weiter`) — the same pause that stands
//     in `session_pauses`, written a second time. It parsed, so it HAS a
//     text and never reaches this check; a marker in some older spelling did
//     not parse, and that one is reported like any other line the DM has to
//     look at.
//
// It runs on the raw client and skips a database that has no such column any
// more, so it is a no-op on every database that has been through 0018.

import type { SqliteClient } from "./driver";

/** One stored row the migration could not turn into a note. */
export interface ListRowProblem {
  /** The campaign the row belongs to. */
  campaign: string;
  /** `sessions/<id>` for a log row, `inbox` for an idea. */
  list: string;
  /** The row's `pos` — its key inside its list. */
  position: number;
  /** The markdown line the row was written as, verbatim. */
  line: string;
}

function hasColumn(client: SqliteClient, table: string, column: string): boolean {
  const rows = client.prepare(`pragma table_info(\`${table}\`)`).all() as unknown as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

interface StoredRow {
  campaign: string;
  list: string;
  position: number;
  line: string;
}

/**
 * Every log and inbox row that holds no text. The inbox headings are left
 * out here rather than in the report, so the check and migration 0018 name
 * the same set of rows as "deleted, nothing lost".
 */
export function findListRowProblems(client: SqliteClient): ListRowProblem[] {
  const problems: ListRowProblem[] = [];
  if (hasColumn(client, "log_entries", "raw")) {
    problems.push(
      ...(client
        .prepare(
          "select campaign_id as campaign, 'sessions/' || session_id as list," +
            " pos as position, raw as line from `log_entries`" +
            " where `text` is null or trim(`text`) = ''" +
            " order by campaign_id, session_id, pos",
        )
        .all() as unknown as StoredRow[]),
    );
  }
  if (hasColumn(client, "inbox_entries", "raw")) {
    problems.push(
      ...(client
        .prepare(
          "select campaign_id as campaign, 'inbox' as list, pos as position," +
            " raw as line from `inbox_entries`" +
            " where (`text` is null or trim(`text`) = '') and trim(`raw`) not glob '#*'" +
            " order by campaign_id, pos",
        )
        .all() as unknown as StoredRow[]),
    );
  }
  return problems;
}

/** The log block a failed check prints — one line per offending row. */
export function listRowProblemReport(problems: ListRowProblem[]): string[] {
  const lines = [
    "List check failed — these log and inbox rows hold no text, so they cannot" +
      " become notes:",
  ];
  for (const problem of problems) {
    lines.push(
      `  · ${problem.campaign} ${problem.list} position ${problem.position}:` +
        ` ${JSON.stringify(problem.line)}`,
    );
  }
  lines.push(
    "Give each of these rows a `text`, or delete the row, directly in the" +
      " database, then start again. Nothing has been changed.",
  );
  return lines;
}

/**
 * Abort the start when a log or inbox row holds no text. The report goes to
 * the log BEFORE the throw, so the operator reads all of it even where only
 * the last line of an error survives.
 */
export function assertListRowsReady(client: SqliteClient): void {
  const problems = findListRowProblems(client);
  if (problems.length === 0) return;
  const report = listRowProblemReport(problems);
  for (const line of report) console.error(line);
  throw new Error(report.join("\n"));
}
