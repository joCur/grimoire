// The list arithmetic of the editable list (components/EditableList.tsx):
// rows that each carry a stable `id` and their own guard `rev`. Pure, so the
// rules are testable without a DOM.
//
// A row is named by its id, never by its position: the version poller
// refetches the list under an open row, and a position another tab shifted
// addresses a neighbour.
//
// Why UP/DOWN buttons and not drag & drop for an order: the lists are short,
// the page has to work on a phone (quality floor) and a drag needs a pointer,
// a drop target and a keyboard fallback that is two buttons anyway.

/** The list with this row in it: in its place when it is there, else at the end. */
export function withRow<T extends { id: string }>(rows: readonly T[] | undefined, row: T): T[] {
  const list = rows ?? [];
  return list.some((stored) => stored.id === row.id)
    ? list.map((stored) => (stored.id === row.id ? row : stored))
    : [...list, row];
}

/** The list without the row of this id. */
export function withoutRow<T extends { id: string }>(rows: readonly T[] | undefined, id: string): T[] {
  return (rows ?? []).filter((row) => row.id !== id);
}

/** The rows in the order `ids` names; a row it does not name keeps its place at the end. */
export function inOrder<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * The ids with `id` moved by `delta` (−1 up, +1 down). Past either end is a
 * NO-OP rather than a clamp: the buttons at the ends are disabled, and a
 * silent clamp would make a mis-wired call look like it worked.
 */
export function moveId(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Has the open row been touched? Only the open row can hold unsaved work, so
 * the unsaved-changes guard asks exactly this — measured against the value
 * the row had when it was opened.
 */
export function isChanged<V>(original: V, value: V): boolean {
  return JSON.stringify(original) !== JSON.stringify(value);
}

// --- what the keyboard does after a row disappears ----------------------------

/**
 * Where the focus goes when a row is deleted.
 *
 * Deleting the row the focus sits in drops the focus to the browser's
 * `document.body`, which on a list you clear from the bottom means reaching
 * for the mouse after every single click. The delete button of the NEIGHBOUR
 * is the honest target.
 *
 * WHICH neighbour is a question about the list the DM is LOOKING at: a list
 * may be sorted and filtered, so the row that takes the deleted one's place
 * is the one at the same DISPLAY position afterwards. Hence `remaining` and
 * `shown` are both measured on the POST-delete display list.
 *
 * With nothing left there is no row to focus, so the add button takes it:
 * the only thing still worth doing.
 */
export type RemoveFocus = { target: "row"; index: number } | { target: "add" };

export function focusAfterRemove(remaining: number, shown: number): RemoveFocus {
  if (remaining <= 0) return { target: "add" };
  const index = Math.min(Math.max(shown, 0), remaining - 1);
  return { target: "row", index };
}
