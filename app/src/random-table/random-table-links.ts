// Where a random table lives in the app (decisions/resources): on the random
// tables page of the campaign the DM is in — a table has no page of its own.
// The table a link names is the one the page opens, ready to roll.

/** The random tables page, optionally at one table. */
export function randomTablesHref(campaign: string, table?: string): string {
  const page = `/campaigns/${campaign}/random-tables`;
  return table === undefined ? page : `${page}?table=${encodeURIComponent(table)}`;
}
