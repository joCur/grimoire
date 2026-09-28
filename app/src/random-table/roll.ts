// Rolling a random table: pure, so the page and its tests share one rule.
//
// A row of a table with dice ranges stands for as many die results as its
// range holds, so a `2-5` of a d20 comes up four times as often as a `1`; the
// number rolled is a result inside that row's range. A table without dice
// ranges gives every row the same chance, and no number.

import type { RandomTable, RandomTableRow } from "@grimoire/shared/random-table";

/** One roll: the row it picked, by its index, and the number rolled, if any. */
export interface Roll {
  row: number;
  value: number | null;
}

/** How many die results a row stands for; a row without a range counts once. */
function weight(row: RandomTableRow): number {
  return row.min === null || row.max === null ? 1 : row.max - row.min + 1;
}

/**
 * Roll `table` once. `random` returns a number in [0, 1), like Math.random.
 * An empty table has no roll.
 */
export function rollTable(
  table: Pick<RandomTable, "rows">,
  random: () => number = Math.random,
): Roll | undefined {
  const total = table.rows.reduce((sum, row) => sum + weight(row), 0);
  if (total === 0) return undefined;
  let left = Math.floor(random() * total);
  for (const [index, row] of table.rows.entries()) {
    const size = weight(row);
    if (left < size) return { row: index, value: row.min === null ? null : row.min + left };
    left -= size;
  }
  return undefined;
}

/**
 * The result of a row as one line of text: its cells, each after its column
 * heading where the table has more than one column.
 */
export function resultText(table: Pick<RandomTable, "columns">, row: RandomTableRow): string {
  if (row.cells.length <= 1) return row.cells[0] ?? "";
  return row.cells
    .map((cell, i) => {
      const heading = table.columns[i] ?? "";
      return heading === "" ? cell : `${heading}: ${cell}`;
    })
    .filter((part) => part !== "")
    .join("; ");
}

/** The die results a row stands for, as the source writes them ("7", "2-5"). */
export function rangeText(row: RandomTableRow): string {
  if (row.min === null || row.max === null) return "";
  return row.min === row.max ? String(row.min) : `${row.min}–${row.max}`;
}
