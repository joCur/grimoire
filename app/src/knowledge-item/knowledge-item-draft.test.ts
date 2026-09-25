// The knowledge page's rules for an item, without a DOM: what it shows, what
// is worth saving, what a save writes and what switching the kind does.

import { describe, expect, test } from "bun:test";
import type { KnowledgeItem } from "@grimoire/shared/knowledge-item";

import {
  emptyKnowledgeItemDraft,
  isIncompleteNaming,
  isSendableKnowledgeItem,
  knowledgeItemChange,
  knowledgeSummary,
  promptKnowledgeCount,
  switchKnowledgeKind,
  visibleKnowledgeItems,
  type KnowledgeItemDraft,
} from "./knowledge-item-draft";

const naming = (from: string, to: string): KnowledgeItemDraft => ({ kind: "naming", from, to, text: "" });
const fact = (text: string): KnowledgeItemDraft => ({ kind: "fact", from: "", to: "", text });
const stored = (id: string, draft: KnowledgeItemDraft): KnowledgeItem => ({ id, ...draft, rev: 1 });

describe("visibleKnowledgeItems", () => {
  const items = [stored("a", naming("Salt Harbour", "Salzhafen")), stored("b", fact("Der Turm ist leer."))];

  test("the order is kept — it is the order of the prompt", () => {
    expect(visibleKnowledgeItems(items).map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("the filter reads all three text fields", () => {
    expect(visibleKnowledgeItems(items, "salzhafen").map((item) => item.id)).toEqual(["a"]);
    expect(visibleKnowledgeItems(items, "harbour").map((item) => item.id)).toEqual(["a"]);
    expect(visibleKnowledgeItems(items, "turm").map((item) => item.id)).toEqual(["b"]);
  });
});

describe("knowledgeSummary", () => {
  test("a pair reads as „Alt → Neu“", () => {
    expect(knowledgeSummary(naming("Salt Harbour", "Salzhafen"))).toBe("Salt Harbour → Salzhafen");
  });

  test("a half-typed pair shows the gap rather than hiding it", () => {
    expect(knowledgeSummary(naming("Salt Harbour", ""))).toBe("Salt Harbour → …");
    expect(knowledgeSummary(naming("", "Salzhafen"))).toBe("… → Salzhafen");
  });

  test("an empty item has no summary — the row falls back to its placeholder", () => {
    expect(knowledgeSummary(naming("", ""))).toBe("");
    expect(knowledgeSummary(fact("  "))).toBe("");
  });

  test("a fact or style is its own sentence", () => {
    expect(knowledgeSummary(fact("Der Turm ist leer."))).toBe("Der Turm ist leer.");
  });
});

describe("what is worth saving, and what a save writes", () => {
  test("a naming item with HALF a pair is still saved — the DM is mid-typing", () => {
    expect(isSendableKnowledgeItem(naming("Salt Harbour", ""))).toBe(true);
    expect(isSendableKnowledgeItem(naming("", "Salzhafen"))).toBe(true);
    expect(isSendableKnowledgeItem(naming("", " "))).toBe(false);
  });

  test("a fact or style item needs its sentence", () => {
    expect(isSendableKnowledgeItem(fact("Der Turm ist leer."))).toBe(true);
    expect(isSendableKnowledgeItem(fact("   "))).toBe(false);
  });

  test("the empty item is what the add action opens; naming is its default kind", () => {
    expect(emptyKnowledgeItemDraft()).toEqual({ kind: "naming", from: "", to: "", text: "" });
    expect(emptyKnowledgeItemDraft("style").kind).toBe("style");
  });

  test("only the fields that moved are written", () => {
    const original = naming("Salt Harbour", "");
    expect(knowledgeItemChange(original, naming("Salt Harbour", "Salzhafen"))).toEqual({
      to: "Salzhafen",
    });
    expect(knowledgeItemChange(original, switchKnowledgeKind(original, "fact"))).toEqual({
      kind: "fact",
      from: "",
      text: "Salt Harbour",
    });
    expect(knowledgeItemChange(original, original)).toEqual({});
  });
});

describe("promptKnowledgeCount", () => {
  test("counts only what the PROMPT will actually carry", () => {
    // A half-filled convention is stored but skipped by the prompt, so
    // promising it in „Mitgeschickter Kontext" would be a lie.
    expect(
      promptKnowledgeCount([
        naming("Salt Harbour", "Salzhafen"),
        naming("Salt Harbour", ""),
        fact("gilt"),
        fact("  "),
      ]),
    ).toBe(2);
    expect(promptKnowledgeCount([])).toBe(0);
  });
});

describe("switchKnowledgeKind", () => {
  test("a sentence becomes the „Alt“ half — the field the DM was typing in", () => {
    expect(switchKnowledgeKind(fact("Salt Harbour"), "naming")).toEqual(naming("Salt Harbour", ""));
  });

  test("a pair becomes ONE sentence, so neither half is lost", () => {
    expect(switchKnowledgeKind(naming("Salt Harbour", "Salzhafen"), "fact")).toEqual(
      fact("Salt Harbour → Salzhafen"),
    );
    // Half a pair carries over without a dangling arrow.
    expect(switchKnowledgeKind(naming("Salt Harbour", ""), "style").text).toBe("Salt Harbour");
  });

  test("fact <-> style keeps the sentence untouched", () => {
    expect(switchKnowledgeKind(fact("Kurz halten."), "style")).toEqual({
      kind: "style",
      from: "",
      to: "",
      text: "Kurz halten.",
    });
  });

  test("the fields of the OLD kind are EMPTIED — nothing invisible survives", () => {
    const switched = switchKnowledgeKind(naming("A", "B"), "fact");
    expect(switched.from).toBe("");
    expect(switched.to).toBe("");
    const back = switchKnowledgeKind(switched, "naming");
    expect(back.text).toBe("");
    expect(back.from).toBe("A → B");
  });

  test("switching to the same kind is the identical item", () => {
    const item = fact("Bleibt.");
    expect(switchKnowledgeKind(item, "fact")).toBe(item);
  });

  test("what survives a round trip is still worth saving", () => {
    const once = switchKnowledgeKind(fact("Salt Harbour"), "naming");
    expect(isSendableKnowledgeItem(once)).toBe(true);
    expect(isSendableKnowledgeItem(switchKnowledgeKind(once, "fact"))).toBe(true);
  });
});

describe("isIncompleteNaming", () => {
  test("exactly one half of the pair is incomplete", () => {
    expect(isIncompleteNaming(naming("Salt Harbour", ""))).toBe(true);
    expect(isIncompleteNaming(naming("", "Salzhafen"))).toBe(true);
  });

  test("both halves, or neither, is not — and only a naming rule can be", () => {
    expect(isIncompleteNaming(naming("Salt Harbour", "Salzhafen"))).toBe(false);
    expect(isIncompleteNaming(naming("", ""))).toBe(false);
    expect(isIncompleteNaming(fact(""))).toBe(false);
  });
});
