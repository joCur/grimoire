// Random-table sources: the random-table-source resource.
//
// A source is its own resource with its own type (decisions/resources,
// @grimoire/shared/random-table), and reference data of the instance
// (decisions/reference-data). Its one writer is the import of a 5etools file:
// it writes every source of the file with its tables, replacing a source
// that is already there, and a source is removed as a whole with its tables.

import { asc, eq, ne } from "drizzle-orm";
import {
  randomTableSourceSchema,
  type RandomTableSource,
  type RandomTableSourceDelete,
} from "@grimoire/shared/random-table";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { randomTables, randomTableSources } from "../db/schema";
import { readFivetoolsTables, type ImportedSource } from "../fivetools-tables";
import { getDb } from "./handle";
import { dropSourceTables, writeSourceTables } from "./random-tables";
import { revConflict } from "./shared";

type SourceRow = typeof randomTableSources.$inferSelect;

/** The source of a stored row, every field flat. */
function renderSource(row: SourceRow): RandomTableSource {
  return randomTableSourceSchema.parse({
    id: row.id,
    title: row.title,
    authors: JSON.parse(row.authors),
    url: row.url,
    rev: row.rev,
  });
}

/** GET /api/random-table-sources — every source, sorted by title. */
export async function listRandomTableSources(): Promise<RandomTableSource[]> {
  const db = await getDb();
  return db
    .select()
    .from(randomTableSources)
    .orderBy(asc(randomTableSources.title))
    .all()
    .map(renderSource);
}

/** GET /api/random-table-sources/:id — 404 for a source that is not imported. */
export async function readRandomTableSource(id: string): Promise<RandomTableSource> {
  const db = await getDb();
  const row = db.select().from(randomTableSources).where(eq(randomTableSources.id, id)).all()[0];
  if (row === undefined) throw new ApiError(404, "random table source not found");
  return renderSource(row);
}

/**
 * POST /api/random-table-sources — import a 5etools file: every source of it
 * that has tables, in ONE transaction. A source already there keeps its id,
 * moves its `rev` and gets the file's tables instead of its old ones.
 */
export async function importRandomTableSources(file: unknown): Promise<RandomTableSource[]> {
  const sources = readFivetoolsTables(file);
  const db = await getDb();
  return db.transaction((tx) => {
    const written: RandomTableSource[] = [];
    for (const source of sources) {
      keepTableIdsApart(tx as unknown as GrimoireDb, source);
      const stored = tx
        .select()
        .from(randomTableSources)
        .where(eq(randomTableSources.id, source.id))
        .all()[0];
      const fields = {
        title: source.title,
        authors: JSON.stringify(source.authors),
        url: source.url,
      };
      if (stored === undefined) {
        tx.insert(randomTableSources)
          .values({ id: source.id, ...fields })
          .run();
      } else {
        tx.update(randomTableSources)
          .set({ ...fields, rev: stored.rev + 1 })
          .where(eq(randomTableSources.id, source.id))
          .run();
      }
      writeSourceTables(tx as unknown as GrimoireDb, source.id, source.title, source.tables);
      const row = tx
        .select()
        .from(randomTableSources)
        .where(eq(randomTableSources.id, source.id))
        .all()[0]!;
      written.push(renderSource(row));
    }
    return written;
  });
}

/**
 * A table id is the source's id and the table's name, so two sources can
 * arrive at the same one ("a" + "b-c", "a-b" + "c"): a table whose id another
 * source holds gets the first free numbered variant.
 */
function keepTableIdsApart(db: GrimoireDb, source: ImportedSource): void {
  const others = new Set(
    db
      .select({ id: randomTables.id })
      .from(randomTables)
      .where(ne(randomTables.sourceId, source.id))
      .all()
      .map((row) => row.id),
  );
  const mine = new Set(source.tables.map((table) => table.id));
  for (const table of source.tables) {
    if (!others.has(table.id)) continue;
    mine.delete(table.id);
    let n = 2;
    while (others.has(`${table.id}-${n}`) || mine.has(`${table.id}-${n}`)) n += 1;
    table.id = `${table.id}-${n}`;
    mine.add(table.id);
  }
}

/**
 * DELETE /api/random-table-sources/:id { rev } — remove the source with its
 * tables for good. There is no trash: importing the file again brings it
 * back. A stale `rev` is 409 with the source as it stands.
 */
export async function deleteRandomTableSource(
  id: string,
  request: RandomTableSourceDelete,
): Promise<void> {
  const db = await getDb();
  db.transaction((tx) => {
    const row = tx.select().from(randomTableSources).where(eq(randomTableSources.id, id)).all()[0];
    if (row === undefined) throw new ApiError(404, "random table source not found");
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "random table source changed", {
        randomTableSource: renderSource(row),
      });
    }
    dropSourceTables(tx as unknown as GrimoireDb, id);
    tx.delete(randomTableSources).where(eq(randomTableSources.id, id)).run();
  });
}
