// The list mechanics of the settings page's two campaign sections (issue #53).
//
// Both the glossary and the campaign knowledge are ONE document the server
// takes as a whole (server/src/server.ts): the array order is the stored
// order, so „umsortieren", „löschen" and „bearbeiten" are all the same
// request. This module is that arithmetic — pure, so the components stay
// about layout and the rules are testable without a DOM.
//
// Why UP/DOWN buttons and not drag & drop: the list is short, the page has to
// work on a phone (quality floor) and a drag needs a pointer, a drop target
// and a keyboard fallback that is two buttons anyway. Two buttons ARE the
// keyboard path, so there is nothing left for the drag to add here.

import type { GlossaryEntry, KnowledgeEntry, KnowledgeKind } from "@grimoire/shared/types";

/**
 * A row of one of the two editors: the stored entry plus a CLIENT-SIDE key.
 *
 * The key exists because the entries have no id — position is their identity
 * on the server (db/schema.ts). React needs a stable key across a reorder or
 * a delete (an index key makes the input the DM is typing in jump to the
 * neighbour's value), and the position cannot provide one.
 */
export interface Row<T> {
  key: string;
  value: T;
}

let keySeq = 0;

/** A fresh row key. Monotonic per page load; it never reaches the server. */
export function nextRowKey(): string {
  keySeq += 1;
  return `row-${keySeq}`;
}

/** Wrap server entries as rows — what a fetch (or a reload after 409) feeds. */
export function toRows<T>(entries: readonly T[]): Array<Row<T>> {
  return entries.map((value) => ({ key: nextRowKey(), value }));
}

/** The entries of a row list, in order — the PUT body. */
export function fromRows<T>(rows: ReadonlyArray<Row<T>>): T[] {
  return rows.map((row) => row.value);
}

/** Replace one row's value, keeping its key (and therefore its focus). */
export function updateRow<T>(
  rows: ReadonlyArray<Row<T>>,
  key: string,
  patch: Partial<T>,
): Array<Row<T>> {
  return rows.map((row) => (row.key === key ? { ...row, value: { ...row.value, ...patch } } : row));
}

export function removeRow<T>(rows: ReadonlyArray<Row<T>>, key: string): Array<Row<T>> {
  return rows.filter((row) => row.key !== key);
}

export function appendRow<T>(rows: ReadonlyArray<Row<T>>, value: T): Array<Row<T>> {
  return [...rows, { key: nextRowKey(), value }];
}

/**
 * Move the row at `index` by `delta` (−1 up, +1 down). Out of range is a
 * NO-OP rather than a clamp: the buttons at the ends are disabled, and a
 * silent clamp would make a mis-wired call look like it worked.
 */
export function moveRow<T>(
  rows: ReadonlyArray<Row<T>>,
  index: number,
  delta: number,
): Array<Row<T>> {
  const to = index + delta;
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return [...rows];
  const next = [...rows];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return [...rows];
  next.splice(to, 0, moved);
  return next;
}

/** An empty glossary row — what „Eintrag hinzufügen" appends. */
export function emptyGlossaryEntry(): GlossaryEntry {
  return { term: "", explanation: "" };
}

/**
 * An empty knowledge row. `naming` is the default kind because it is the one
 * the ticket is actually about (and the only one the server can check
 * afterwards) — the other two are a sentence the DM can also just type into
 * the campaign body.
 */
export function emptyKnowledgeEntry(kind: KnowledgeKind = "naming"): KnowledgeEntry {
  return { kind, from: "", to: "", text: "" };
}

/**
 * Is a glossary row worth sending? A term-less row is a row the DM added and
 * left alone — the server would refuse it (400 „needs a non-empty term"), so
 * it is dropped on the way out instead of blocking the whole save.
 */
export function isSendableGlossaryEntry(entry: GlossaryEntry): boolean {
  return entry.term.trim() !== "";
}

/**
 * Is a knowledge row worth sending? Anything with SOME content: a `naming`
 * with only its „Alt" half is kept on purpose (the server stores it, the
 * prompt skips it — see server/src/routes/api.ts), because throwing away
 * half-typed work on save is worse than carrying an unfinished rule.
 */
export function isSendableKnowledgeEntry(entry: KnowledgeEntry): boolean {
  return entry.kind === "naming"
    ? entry.from.trim() !== "" || entry.to.trim() !== ""
    : entry.text.trim() !== "";
}

/**
 * How many knowledge entries actually reach the PROMPT — what the generator
 * view's „Mitgeschickter Kontext" counts (issue #53 AK5).
 *
 * Not simply `entries.length`: a half-typed naming convention is stored but
 * skipped by the prompt (server/src/store/read.ts knowledgeText), and a count
 * that promises a rule the model never saw is the one number in that line
 * nobody could act on. The rule is mirrored here rather than asked for over
 * the wire — it is two conditions, and an endpoint for a number the client
 * already has the data for is worse.
 */
export function promptKnowledgeCount(entries: readonly KnowledgeEntry[]): number {
  return entries.filter((entry) =>
    entry.kind === "naming"
      ? entry.from.trim() !== "" && entry.to.trim() !== ""
      : entry.text.trim() !== "",
  ).length;
}

/**
 * Has the DM changed anything? Compared as the SENDABLE payload, so adding an
 * empty row does not arm the save button and pressing „Speichern" on an
 * untouched list is never offered.
 */
export function isDirty<T>(sendable: readonly T[], stored: readonly T[]): boolean {
  return JSON.stringify(sendable) !== JSON.stringify(stored);
}
