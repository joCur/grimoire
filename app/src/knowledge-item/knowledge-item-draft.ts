// What the knowledge page does with an item, pure: which items it shows,
// what a row says, what an open item's form holds and what a save writes.

import type {
  KnowledgeItem,
  KnowledgeItemChange,
  KnowledgeKind,
} from "@grimoire/shared/knowledge-item";

/** The form of one item: its kind and its three text fields. */
export type KnowledgeItemDraft = Pick<KnowledgeItem, "kind" | "from" | "to" | "text">;

/**
 * The knowledge as the page shows it: in its ORDER, filtered by all three
 * text fields. The order is the order of the prompt
 * (server/src/store/knowledge-items.ts), so it is the DM's to arrange — hence
 * up/down here and not on the glossary.
 */
export function visibleKnowledgeItems(items: readonly KnowledgeItem[], filter = ""): KnowledgeItem[] {
  const needle = filter.trim().toLocaleLowerCase("de");
  const matches = (text: string) => text.toLocaleLowerCase("de").includes(needle);
  return items.filter(
    (item) => needle === "" || matches(item.from) || matches(item.to) || matches(item.text),
  );
}

/**
 * The one line a row shows next to its kind badge: the pair as `from → to`,
 * or the sentence. Empty for an item with nothing in it yet — the row then
 * falls back to its own placeholder rather than showing a lone arrow.
 */
export function knowledgeSummary(item: KnowledgeItemDraft): string {
  if (item.kind !== "naming") return item.text.trim();
  const from = item.from.trim();
  const to = item.to.trim();
  if (from === "" && to === "") return "";
  return `${from === "" ? "…" : from} → ${to === "" ? "…" : to}`;
}

/** The form of a stored item. */
export function knowledgeItemDraft(item: KnowledgeItem): KnowledgeItemDraft {
  return { kind: item.kind, from: item.from, to: item.to, text: item.text };
}

/**
 * An empty item. `naming` is the default kind because it is the only one the
 * server can check afterwards — the other two are a sentence the DM can also
 * just type into the campaign body.
 */
export function emptyKnowledgeItemDraft(kind: KnowledgeKind = "naming"): KnowledgeItemDraft {
  return { kind, from: "", to: "", text: "" };
}

/**
 * Is an item worth saving? Any VISIBLE field with content — which since
 * `switchKnowledgeKind` is the same thing as „any field", because the fields
 * the current kind has no input for are always empty.
 *
 * A `naming` with only its `from` half is kept on purpose (the server stores
 * it, the prompt skips it), because throwing away half-typed work on save is
 * worse than carrying an unfinished rule.
 */
export function isSendableKnowledgeItem(draft: KnowledgeItemDraft): boolean {
  return draft.kind === "naming"
    ? draft.from.trim() !== "" || draft.to.trim() !== ""
    : draft.text.trim() !== "";
}

/**
 * Switching an item's KIND, carrying the text over.
 *
 * Keeping all three fields filled and only hiding the ones the new kind has
 * no input for would be the worst of both: the text invisible but still
 * saved, still counted and still sent. Clearing them instead would throw the
 * sentence away on a mis-click. So the text MOVES into the new form, and the
 * old kind's fields are emptied:
 *
 *   * fact/style → naming: the sentence becomes `from`, which is where the DM
 *     was typing and where they will see it;
 *   * naming → fact/style: the pair becomes `from → to` as one sentence, so
 *     both halves survive in the field that is now on screen;
 *   * fact ↔ style: the sentence is the same sentence.
 */
export function switchKnowledgeKind(draft: KnowledgeItemDraft, kind: KnowledgeKind): KnowledgeItemDraft {
  if (kind === draft.kind) return draft;
  if (kind === "naming") return { kind, from: draft.text.trim(), to: "", text: "" };
  if (draft.kind === "naming") {
    const pair = [draft.from.trim(), draft.to.trim()].filter((part) => part !== "");
    return { kind, from: "", to: "", text: pair.join(" → ") };
  }
  return { kind, from: "", to: "", text: draft.text };
}

/**
 * A `naming` item with exactly one half of its pair — stored on purpose (the
 * DM is mid-typing) but skipped by the prompt, so the form says so quietly
 * instead of letting a rule look active that never reaches the model.
 */
export function isIncompleteNaming(draft: KnowledgeItemDraft): boolean {
  if (draft.kind !== "naming") return false;
  return (draft.from.trim() === "") !== (draft.to.trim() === "");
}

/**
 * How many items actually reach the PROMPT — what the generator view's
 * context line counts. Not simply the number of items: a half-typed naming
 * convention is stored but skipped by the prompt
 * (server/src/store/knowledge-items.ts knowledgeText), and a count that
 * promises a rule the model never saw is the one number in that line nobody
 * could act on.
 */
export function promptKnowledgeCount(items: readonly KnowledgeItemDraft[]): number {
  return items.filter((item) =>
    item.kind === "naming"
      ? item.from.trim() !== "" && item.to.trim() !== ""
      : item.text.trim() !== "",
  ).length;
}

/**
 * The write of an open item: ONLY the fields that moved since it was opened,
 * so a forced save after a conflict keeps what somebody else changed in a
 * field the DM did not touch.
 */
export function knowledgeItemChange(
  original: KnowledgeItemDraft,
  draft: KnowledgeItemDraft,
): KnowledgeItemChange {
  return {
    ...(draft.kind === original.kind ? {} : { kind: draft.kind }),
    ...(draft.from === original.from ? {} : { from: draft.from }),
    ...(draft.to === original.to ? {} : { to: draft.to }),
    ...(draft.text === original.text ? {} : { text: draft.text }),
  };
}
