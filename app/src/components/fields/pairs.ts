// The rules of a key/value field (./PairsField.tsx): how a stored set becomes
// editable rows, how the rows are written back, and which rows cannot be
// written at all. Pure, so every rule is unit-testable.
//
// A row without a VALUE is a deleted key, never `key: ''`; a row without a
// NAME cannot be written and blocks the save instead of vanishing; two rows
// with the same name would swallow the earlier value, so they block it too.

import type { Translate } from "@/i18n/format";

/** One editable row. */
export interface Pair {
  key: string;
  value: string;
}

/** A stored set as rows, in its order; a value is shown as its text. */
export function pairsOf(record: Readonly<Record<string, string | number>> | undefined): Pair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}

/** Trimmed, without the rows that write nothing — the shape rows are compared in. */
function written(pairs: readonly Pair[]): Pair[] {
  return pairs
    .map((pair) => ({ key: pair.key.trim(), value: pair.value.trim() }))
    .filter((pair) => pair.key !== "" && pair.value !== "");
}

/**
 * A value keeps its type: text that is exactly how a number prints stays a
 * NUMBER, everything else stays text. Without this, editing one row would
 * rewrite `{wis: 2}` as `{wis: '2'}` — and a typed `+2` stays the text `+2`.
 */
function scalar(value: string): string | number {
  const parsed = Number(value);
  return value !== "" && Number.isFinite(parsed) && String(parsed) === value ? parsed : value;
}

/** The set the rows write, or `null` when no row writes anything (the value is cleared). */
export function pairsValue(pairs: readonly Pair[]): Record<string, string | number> | null {
  const rows = written(pairs);
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((pair) => [pair.key, scalar(pair.value)]));
}

/**
 * Do two row lists write the same set? Order counts — a reordered set is a
 * change the DM made — while whitespace and empty rows do not.
 */
export function samePairs(a: readonly Pair[], b: readonly Pair[]): boolean {
  return JSON.stringify(written(a)) === JSON.stringify(written(b));
}

/**
 * What blocks the save in these rows, or undefined: a row with a value but no
 * name, then two rows with the same name. A row that is completely empty (or
 * holds only a name, which deletes that key) is fine.
 */
export function pairsIssue(pairs: readonly Pair[], t: Translate): string | undefined {
  const seen = new Set<string>();
  let nameless = false;
  let duplicate: string | undefined;
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key === "") {
      if (pair.value.trim() !== "") nameless = true;
      continue;
    }
    if (seen.has(key)) duplicate ??= key;
    seen.add(key);
  }
  if (nameless) return t("properties.issue.namelessRow");
  if (duplicate !== undefined) return t("properties.issue.duplicateName", { name: duplicate });
  return undefined;
}
