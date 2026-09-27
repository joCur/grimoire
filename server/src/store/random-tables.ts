// Random tables: the random-table resource.
//
// A random table is its own resource with its own type (decisions/resources,
// @grimoire/shared/random-table), and reference data of the instance
// (decisions/reference-data): no campaign scopes it. It is written only by the
// import of its source (./random-table-sources.ts), which hands its tables to
// `writeSourceTables` below, and it goes with its source.

import { asc, eq, sql } from "drizzle-orm";
import { randomTableSchema, type RandomTable } from "@grimoire/shared/random-table";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { randomTableRows, randomTables } from "../db/schema";
import type { ImportedTable } from "../fivetools-tables";
import { getDb } from "./handle";

/** The search-index kind of a random table. */
export const RANDOM_TABLE_KIND = "random-table";

type RandomTableRowOfDb = typeof randomTables.$inferSelect;

/** The random table of a stored row and its stored rows, every field flat. */
function renderRandomTable(db: GrimoireDb, row: RandomTableRowOfDb): RandomTable {
  const rows = db
    .select()
    .from(randomTableRows)
    .where(eq(randomTableRows.tableId, row.id))
    .orderBy(asc(randomTableRows.pos))
    .all();
  return randomTableSchema.parse({
    id: row.id,
    source: row.sourceId,
    name: row.name,
    caption: row.caption,
    intro: row.intro,
    die: row.die,
    columns: JSON.parse(row.columns),
    rows: rows.map((r) => ({ min: r.min, max: r.max, cells: JSON.parse(r.cells) })),
    rev: row.rev,
  });
}

/** GET /api/random-tables[?source=] — every table, or a source's, in the source's order. */
export async function listRandomTables(source?: string): Promise<RandomTable[]> {
  const db = await getDb();
  const rows = db
    .select()
    .from(randomTables)
    .where(source === undefined ? undefined : eq(randomTables.sourceId, source))
    .orderBy(asc(randomTables.sourceId), asc(randomTables.pos))
    .all();
  return rows.map((row) => renderRandomTable(db, row));
}

/** GET /api/random-tables/:id — 404 for an id no source has. */
export async function readRandomTable(id: string): Promise<RandomTable> {
  const db = await getDb();
  const row = db.select().from(randomTables).where(eq(randomTables.id, id)).all()[0];
  if (row === undefined) throw new ApiError(404, "random table not found");
  return renderRandomTable(db, row);
}

/**
 * Replace the tables of a source with `tables`, INSIDE the import's
 * transaction: the old tables go (their rows with them), the new ones are
 * written in the file's order, and the search index follows. A table whose id
 * stays keeps counting its `rev` on.
 */
export function writeSourceTables(
  tx: GrimoireDb,
  source: string,
  title: string,
  tables: ImportedTable[],
): void {
  const before = new Map(
    tx
      .select({ id: randomTables.id, rev: randomTables.rev })
      .from(randomTables)
      .where(eq(randomTables.sourceId, source))
      .all()
      .map((row) => [row.id, row.rev]),
  );
  dropSourceTables(tx, source);
  tables.forEach((table, pos) => {
    const rev = before.get(table.id);
    tx.insert(randomTables)
      .values({
        id: table.id,
        sourceId: source,
        pos,
        name: table.name,
        caption: table.caption,
        intro: table.intro,
        die: table.die,
        columns: JSON.stringify(table.columns),
        rev: rev === undefined ? 1 : rev + 1,
      })
      .run();
    // Inserted in chunks: a table can have more than a thousand rows, more
    // than SQLite takes as the variables of one statement.
    for (let start = 0; start < table.rows.length; start += 100) {
      tx.insert(randomTableRows)
        .values(
          table.rows.slice(start, start + 100).map((row, i) => ({
            tableId: table.id,
            pos: start + i,
            min: row.min,
            max: row.max,
            cells: JSON.stringify(row.cells),
          })),
        )
        .run();
    }
    tx.run(sql`
      insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
      values (${table.name}, ${table.id}, ${title}, ${[table.caption, table.intro].join("\n\n").trim()},
              null, ${RANDOM_TABLE_KIND}, ${table.id})
    `);
  });
}

/**
 * Remove every table of a source and their index rows, INSIDE the caller's
 * transaction. The rows of each table go with it (their foreign key).
 */
export function dropSourceTables(tx: GrimoireDb, source: string): void {
  tx.run(sql`
    delete from search_fts
    where campaign_id is null and kind = ${RANDOM_TABLE_KIND}
      and entity_id in (select id from random_tables where source_id = ${source})
  `);
  tx.delete(randomTables).where(eq(randomTables.sourceId, source)).run();
}
