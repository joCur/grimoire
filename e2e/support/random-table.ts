// What the suite knows about random tables and their sources: their request
// paths, and the small 5etools file written for the suite. No published table
// is in the repository (decisions/reference-data), so the suite imports its
// own.

import path from "node:path";

import { E2E_FIXTURES_DIR } from "./paths";

/** The 5etools file of the suite: one source of two tables, one source without any. */
export const RANDOM_TABLES_FILE = path.join(E2E_FIXTURES_DIR, "random-tables.json");

/** The source the file's tables belong to. */
export const HARBOUR_SOURCE = "harbourtables";

/** The request path of the sources, or of one source. */
export function randomTableSourcePath(id?: string): string {
  return id === undefined
    ? "random-table-sources"
    : `random-table-sources/${encodeURIComponent(id)}`;
}

/** The request path of the tables, or of one table. */
export function randomTablePath(id?: string): string {
  return id === undefined ? "random-tables" : `random-tables/${encodeURIComponent(id)}`;
}
