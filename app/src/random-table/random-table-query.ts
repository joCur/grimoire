// The queries of the random tables. They belong to the instance, not to a
// campaign, so no key names a campaign and the campaign's version poll never
// invalidates them; the import and the removal on this page refresh them.

import type { QueryKey } from "@tanstack/react-query";

import { fetchRandomTable, fetchRandomTableSources, fetchRandomTablesOf } from "./random-table-api";

/** Everything the random tables page reads — what an import refreshes. */
export const RANDOM_TABLES_SCOPE: QueryKey = ["random-tables"];

/** Key and fetch of every imported source. */
export function randomTableSourcesQuery() {
  return { queryKey: [...RANDOM_TABLES_SCOPE, "sources"], queryFn: fetchRandomTableSources };
}

/** Key and fetch of the tables of one source. */
export function randomTablesOfQuery(source: string) {
  return {
    queryKey: [...RANDOM_TABLES_SCOPE, "of", source],
    queryFn: () => fetchRandomTablesOf(source),
  };
}

/** Key and fetch of one table. */
export function randomTableQuery(id: string) {
  return { queryKey: [...RANDOM_TABLES_SCOPE, "table", id], queryFn: () => fetchRandomTable(id) };
}
