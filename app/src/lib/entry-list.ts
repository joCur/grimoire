// The list mechanics of the two campaign-content pages (issue #53, PO
// feedback on PR #87): „Kampagnenwissen" (/:campaign/knowledge) and „Glossar"
// (/:campaign/glossary).
//
// Both lists are ONE document the server takes as a whole (server/src/server.ts):
// the array order is the stored order, so „umsortieren", „löschen" and
// „bearbeiten" are all the same request — a whole-list PUT guarded by the
// list's `rev`. This module is that arithmetic — pure, so the pages stay about
// layout and the rules are testable without a DOM.
//
// WHAT CHANGED WITH THE PAGES. The first version lived inline under
// `/settings`: every row an always-open form, one global „Speichern" over the
// lot, and a client-side row key per entry so React could follow a row through
// a reorder. With 30 glossary terms that page was a wall of tiny text fields
// (PO feedback). The pages open exactly ONE entry at a time, so the identity
// problem disappears with the keys: the open entry is named by its POSITION in
// the stored list, which is the same thing the server calls it.
//
// Why UP/DOWN buttons and not drag & drop for the knowledge order: the list is
// short, the page has to work on a phone (quality floor) and a drag needs a
// pointer, a drop target and a keyboard fallback that is two buttons anyway.

import type { GlossaryEntry, KnowledgeEntry, KnowledgeKind } from "@grimoire/shared/types";

// --- the stored array, edited by position ------------------------------------

/** Replace the entry at `index`. Out of range is a no-op copy. */
export function replaceEntry<T>(entries: readonly T[], index: number, value: T): T[] {
  return entries.map((entry, i) => (i === index ? value : entry));
}

export function removeEntry<T>(entries: readonly T[], index: number): T[] {
  return entries.filter((_, i) => i !== index);
}

export function appendEntry<T>(entries: readonly T[], value: T): T[] {
  return [...entries, value];
}

/**
 * Move the entry at `index` by `delta` (−1 up, +1 down). Out of range is a
 * NO-OP rather than a clamp: the buttons at the ends are disabled, and a
 * silent clamp would make a mis-wired call look like it worked.
 */
export function moveEntry<T>(entries: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= entries.length || to < 0 || to >= entries.length) return [...entries];
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return [...entries];
  next.splice(to, 0, moved);
  return next;
}

// --- what the page SHOWS: order and filter -----------------------------------

/**
 * One row on screen: the entry plus the position it holds in the STORED list.
 *
 * The two are not the same as soon as the page sorts or filters, and every
 * write addresses the stored position — so the display row has to carry it
 * rather than letting a `map` index stand in for it (that is how a filtered
 * list deletes the wrong term).
 */
export interface EntryRow<T> {
  index: number;
  entry: T;
}

function rows<T>(entries: readonly T[]): Array<EntryRow<T>> {
  return entries.map((entry, index) => ({ index, entry }));
}

/** Case- and diacritics-tolerant „does this row match what was typed". */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase("de").includes(needle);
}

/**
 * The glossary as the page shows it: ALPHABETICAL by term, filtered.
 *
 * Alphabetical and not stored order because a glossary is looked things up in,
 * and „where did I put it" is not a question a reference list should ask. The
 * stored order therefore carries no meaning here, which is why the page offers
 * no up/down (PO feedback on PR #87).
 */
export function glossaryRows(
  entries: readonly GlossaryEntry[],
  filter = "",
): Array<EntryRow<GlossaryEntry>> {
  const needle = filter.trim().toLocaleLowerCase("de");
  return rows(entries)
    .filter(
      ({ entry }) =>
        needle === "" || contains(entry.term, needle) || contains(entry.explanation, needle),
    )
    .sort((a, b) => a.entry.term.localeCompare(b.entry.term, "de"));
}

/**
 * The campaign knowledge as the page shows it: STORED order, filtered.
 *
 * The order is the order of the prompt (server/src/store/read.ts), so it is
 * the DM's to arrange — hence up/down here and not on the glossary.
 */
export function knowledgeRows(
  entries: readonly KnowledgeEntry[],
  filter = "",
): Array<EntryRow<KnowledgeEntry>> {
  const needle = filter.trim().toLocaleLowerCase("de");
  return rows(entries).filter(
    ({ entry }) =>
      needle === "" ||
      contains(entry.from, needle) ||
      contains(entry.to, needle) ||
      contains(entry.text, needle),
  );
}

/**
 * The one line a knowledge row shows next to its kind badge: the pair as
 * „Alt → Neu", or the sentence. Empty for an entry with nothing in it yet —
 * the row then falls back to its own placeholder rather than showing a lone
 * arrow.
 */
export function knowledgeSummary(entry: KnowledgeEntry): string {
  if (entry.kind !== "naming") return entry.text.trim();
  const from = entry.from.trim();
  const to = entry.to.trim();
  if (from === "" && to === "") return "";
  return `${from === "" ? "…" : from} → ${to === "" ? "…" : to}`;
}

// --- the entries themselves ---------------------------------------------------

/** An empty glossary entry — what „Neuer Begriff" opens. */
export function emptyGlossaryEntry(): GlossaryEntry {
  return { term: "", explanation: "" };
}

/**
 * An empty knowledge entry. `naming` is the default kind because it is the one
 * the ticket is actually about (and the only one the server can check
 * afterwards) — the other two are a sentence the DM can also just type into
 * the campaign body.
 */
export function emptyKnowledgeEntry(kind: KnowledgeKind = "naming"): KnowledgeEntry {
  return { kind, from: "", to: "", text: "" };
}

/**
 * Is a glossary entry worth saving? A term-less entry is one the DM opened and
 * left alone — the server would refuse it (400 „needs a non-empty term"), so
 * „Speichern" stays disabled instead of answering with an error.
 */
export function isSendableGlossaryEntry(entry: GlossaryEntry): boolean {
  return entry.term.trim() !== "";
}

/**
 * Is a knowledge entry worth saving? Any VISIBLE column with content — which
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
 * Switching a knowledge entry's KIND, carrying the text over (review of #53).
 *
 * Keeping all three columns filled and only hiding the ones the new kind has
 * no field for is the worst of both: the text is invisible but still saved,
 * still counted and still sent — so a mis-picked kind left a fact in the
 * database that nothing on screen explains.
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
 * A `naming` entry with exactly one half of its pair — stored on purpose (the
 * DM is mid-typing) but skipped by the prompt, so the form says so quietly
 * instead of letting a rule look active that never reaches the model.
 */
export function isIncompleteNamingEntry(entry: KnowledgeEntry): boolean {
  if (entry.kind !== "naming") return false;
  return (entry.from.trim() === "") !== (entry.to.trim() === "");
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
 * Has the OPEN entry been touched? Only the open one has unsaved work now —
 * everything else on the page is either stored or not on screen — so the
 * unsaved-changes guard asks exactly this question (PO feedback on PR #87).
 */
export function isEntryDirty<T>(draft: T, stored: T | undefined): boolean {
  return JSON.stringify(draft) !== JSON.stringify(stored ?? null);
}

// --- what the keyboard does after an entry disappears -------------------------

/**
 * Where the focus goes when the entry at `index` is deleted from a list of
 * `count` entries (review of #53).
 *
 * Deleting the row the focus sits in drops the focus to the document, which on
 * a list you clear from the bottom means reaching for the mouse after every
 * single click. The delete button of the NEIGHBOUR is the honest target — the
 * next row's, because that is where the deleted row's place is now, and the
 * previous row's for the last one. With nothing left there is no row to focus,
 * so the „Neuer Eintrag" action takes it: the only thing still worth doing.
 */
export type RemoveFocus = { target: "row"; index: number } | { target: "add" };

export function focusAfterRemove(count: number, index: number): RemoveFocus {
  if (count <= 1 || index < 0 || index >= count) return { target: "add" };
  return { target: "row", index: index < count - 1 ? index : index - 1 };
}
