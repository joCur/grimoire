// A RANDOM TABLE — a table the DM rolls at the table — and the SOURCE it was
// imported from, each with its one zod schema (decisions/resources).
//
// Random tables are reference data of the instance (decisions/reference-data):
// the same tables serve every campaign. None ships with the app, because
// their sources are not shared for redistribution: the DM imports a source
// file into their own instance, and its import is the only writer. Importing
// the same source again replaces it, and a source is removed as a whole with
// its tables. So there is no create or patch form of a single table here.

import { z } from "zod";

/**
 * One row of a random table: `min` and `max` the die results it stands for,
 * both null on a table without dice ranges (every row is then equally
 * likely), and `cells` its result columns as plain text, one per column.
 */
export const randomTableRowSchema = z.strictObject({
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
  cells: z.array(z.string()),
});

export type RandomTableRow = z.infer<typeof randomTableRowSchema>;

/**
 * A random table, exactly as `GET /api/random-tables/:id` answers it: `id` its
 * stable key, `source` the id of the source it was imported from, `name` the
 * table as its source names it, `caption` and `intro` the source's heading
 * and its introductory text (both empty where it gives none), `die` the
 * number of sides of the die the rows are rolled with, null for a table
 * without dice ranges, `columns` the headings of the result columns, `rows`
 * the rows in the source's order, and `rev` the row version.
 */
export const randomTableSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  name: z.string(),
  caption: z.string(),
  intro: z.string(),
  die: z.number().int().positive().nullable(),
  columns: z.array(z.string()),
  rows: z.array(randomTableRowSchema),
  rev: z.number(),
});

export type RandomTable = z.infer<typeof randomTableSchema>;

/**
 * A source of random tables, exactly as `GET /api/random-table-sources/:id`
 * answers it: `id` its stable key, taken from the source file, `title` and
 * `authors` as the source names itself, `url` where it is published (empty
 * where the file names no link), and `rev` the row version.
 */
export const randomTableSourceSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  url: z.string(),
  rev: z.number(),
});

export type RandomTableSource = z.infer<typeof randomTableSourceSchema>;

/**
 * The body of `DELETE /api/random-table-sources/:id`, which removes the source
 * with its tables: the guard the source was read with.
 */
export const randomTableSourceDeleteSchema = randomTableSourceSchema.pick({ rev: true });

export type RandomTableSourceDelete = z.infer<typeof randomTableSourceDeleteSchema>;
