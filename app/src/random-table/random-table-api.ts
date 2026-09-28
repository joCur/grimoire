// The API client of a random table and its source (decisions/resources):
// reference data of the instance (decisions/reference-data), written only by
// the import of a 5etools file and removed a source at a time. Built from the
// shared HTTP helpers (../api.ts).

import type { RandomTable, RandomTableSource } from "@grimoire/shared/random-table";

import { deleteJson, getJson, postJson } from "@/api";

/** Every imported source, sorted by title. */
export function fetchRandomTableSources(): Promise<RandomTableSource[]> {
  return getJson<RandomTableSource[]>("/random-table-sources");
}

/** The tables of one source, in the order of its file. */
export function fetchRandomTablesOf(source: string): Promise<RandomTable[]> {
  return getJson<RandomTable[]>(`/random-tables?source=${encodeURIComponent(source)}`);
}

/** One table with its rows. */
export function fetchRandomTable(id: string): Promise<RandomTable> {
  return getJson<RandomTable>(`/random-tables/${encodeURIComponent(id)}`);
}

/**
 * Import a 5etools file, sent as it was read: every source of it with its
 * tables, a source already there replaced. Answers the sources written.
 */
export function importRandomTables(file: unknown): Promise<RandomTableSource[]> {
  return postJson<RandomTableSource[]>("/random-table-sources", file);
}

/** Remove a source with its tables, against the `rev` it was read with. */
export function removeRandomTableSource(
  source: Pick<RandomTableSource, "id" | "rev">,
): Promise<void> {
  return deleteJson(`/random-table-sources/${encodeURIComponent(source.id)}`, { rev: source.rev });
}
