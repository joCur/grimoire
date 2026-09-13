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

// --- the DRAFT: which list it belongs to, and when it may be replaced -------

/**
 * What the DM is typing, plus everything needed to decide whether a fresh
 * server answer may replace it (review of #53).
 *
 * `id` is the list's IDENTITY — campaign AND list. Without it the editor
 * recognised a reseed by `rev` alone, and two lists whose revs happen to
 * match are indistinguishable: switching `?from=a` to `?from=b` kept
 * campaign A's rows on screen and would have SAVED them under campaign B.
 *
 * `base` is the server list this draft started from. Dirtiness is measured
 * against it and not against the latest fetch, so an edit somewhere else does
 * not silently make the DM's untouched list look changed (or their changed
 * list look saved).
 */
export interface DraftState<T> {
  id: string;
  rev: number;
  base: T[];
  rows: Array<Row<T>>;
}

/** The identity of one list — its react-query key, which already says both. */
export function listId(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

/** A fresh draft for a server answer. */
export function seedDraft<T>(server: { id: string; rev: number; entries: readonly T[] }): DraftState<T> {
  return { id: server.id, rev: server.rev, base: [...server.entries], rows: toRows(server.entries) };
}

/**
 * What to do with the draft when a server answer arrives.
 *
 *   * „seed" — take the server's list: there is no draft yet, the list is a
 *     DIFFERENT one (campaign or list switched), or the draft is untouched and
 *     the server moved on.
 *   * „stale" — the server moved on WHILE the DM has unsaved changes. Their
 *     work stays on screen and they are told (ADR #4: never a silent
 *     overwrite, in neither direction); reloading is their decision.
 *   * „keep" — nothing changed.
 */
export type DraftSync<T> =
  | { action: "keep" }
  | { action: "seed"; draft: DraftState<T> }
  | { action: "stale" };

export function syncDraft<T>(
  draft: DraftState<T> | undefined,
  server: { id: string; rev: number; entries: readonly T[] },
  dirty: boolean,
): DraftSync<T> {
  if (draft === undefined || draft.id !== server.id) {
    return { action: "seed", draft: seedDraft(server) };
  }
  if (draft.rev === server.rev) return { action: "keep" };
  return dirty ? { action: "stale" } : { action: "seed", draft: seedDraft(server) };
}

// --- what the keyboard does after a row disappears ---------------------------

/**
 * Where the focus goes when the row at `index` is deleted from a list of
 * `count` rows (review of #53).
 *
 * Deleting the row the focus sits in drops the focus to the document, which
 * on a list you clear from the bottom means reaching for the mouse after
 * every single click. The delete button of the NEIGHBOUR is the honest
 * target — the next row's, because that is where the deleted row's place is
 * now, and the previous row's for the last one. With nothing left there is
 * no row to focus, so „Eintrag hinzufügen" takes it: the only thing still
 * worth doing.
 */
export type RemoveFocus = { target: "row"; index: number } | { target: "add" };

export function focusAfterRemove(count: number, index: number): RemoveFocus {
  if (count <= 1 || index < 0 || index >= count) return { target: "add" };
  return { target: "row", index: index < count - 1 ? index : index - 1 };
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
 * Switching a knowledge entry's KIND, carrying the text over (review of #53).
 *
 * The old behaviour kept all three columns filled and only hid the ones the
 * new kind has no field for. That is the worst of both: the text is invisible
 * but still saved, still counted and still sent — so a mis-picked kind left a
 * fact in the database that nothing on screen explains.
 *
 * Clearing them instead would throw the sentence away on a mis-click. So the
 * text MOVES into the new form, and the old kind's columns are emptied:
 *
 *   * fact/style → naming: the sentence becomes „Alt", which is where the DM
 *     was typing and where they will see it;
 *   * naming → fact/style: the pair becomes „Alt → Neu" as one sentence, so
 *     both halves survive in the field that is now on screen;
 *   * fact ↔ style: the sentence is the same sentence.
 *
 * Nothing is lost and nothing is hidden: what is stored is what is visible.
 */
export function switchKnowledgeKind(entry: KnowledgeEntry, kind: KnowledgeKind): KnowledgeEntry {
  if (kind === entry.kind) return entry;
  if (kind === "naming") {
    return { kind, from: entry.text.trim(), to: "", text: "" };
  }
  if (entry.kind === "naming") {
    const pair = [entry.from.trim(), entry.to.trim()].filter((part) => part !== "");
    return { kind, from: "", to: "", text: pair.join(" → ") };
  }
  return { kind, from: "", to: "", text: entry.text };
}

/**
 * A `naming` row with exactly one half of its pair — stored on purpose (the
 * DM is mid-typing) but skipped by the prompt, so the UI says so quietly
 * instead of letting a rule look active that never reaches the model.
 */
export function isIncompleteNamingEntry(entry: KnowledgeEntry): boolean {
  if (entry.kind !== "naming") return false;
  return (entry.from.trim() === "") !== (entry.to.trim() === "");
}

/**
 * Is a knowledge row worth sending? Any VISIBLE column with content — which
 * since `switchKnowledgeKind` is the same thing as „any column", because the
 * columns the current kind has no field for are always empty.
 *
 * A `naming` with only its „Alt" half is kept on purpose (the server stores
 * it, the prompt skips it — see server/src/routes/api.ts), because throwing
 * away half-typed work on save is worse than carrying an unfinished rule.
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
