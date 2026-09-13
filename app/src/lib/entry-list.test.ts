// The list mechanics of the two campaign-content pages (issue #53).
//
// All pure, so the interesting rules — what survives a reorder, which stored
// position a filtered row addresses, what is worth saving — are asserted
// without a DOM.

import { describe, expect, test } from "bun:test";
import type { GlossaryEntry, KnowledgeEntry } from "@grimoire/shared/types";

import {
  appendEntry,
  emptyGlossaryEntry,
  emptyKnowledgeEntry,
  focusAfterRemove,
  glossaryRows,
  isEntryDirty,
  isIncompleteNamingEntry,
  isSendableGlossaryEntry,
  isSendableKnowledgeEntry,
  knowledgeRows,
  knowledgeSummary,
  moveEntry,
  promptKnowledgeCount,
  removeEntry,
  replaceEntry,
  switchKnowledgeKind,
} from "./entry-list";

const naming = (from: string, to: string): KnowledgeEntry => ({
  kind: "naming",
  from,
  to,
  text: "",
});
const fact = (text: string): KnowledgeEntry => ({ kind: "fact", from: "", to: "", text });
const term = (t: string, explanation = ""): GlossaryEntry => ({ term: t, explanation });

describe("editing the stored array by position", () => {
  test("replace touches only the named position", () => {
    expect(replaceEntry([fact("a"), fact("b")], 0, fact("A"))).toEqual([fact("A"), fact("b")]);
  });

  test("remove and append", () => {
    expect(removeEntry([fact("a"), fact("b")], 0)).toEqual([fact("b")]);
    expect(appendEntry([fact("b")], fact("c"))).toEqual([fact("b"), fact("c")]);
  });

  test("an out-of-range replace changes nothing", () => {
    const entries = [fact("a")];
    expect(replaceEntry(entries, 7, fact("X"))).toEqual(entries);
  });
});

describe("moveEntry", () => {
  const entries = [fact("a"), fact("b"), fact("c")];
  const texts = (list: KnowledgeEntry[]) => list.map((e) => e.text);

  test("up and down swap with the neighbour", () => {
    expect(texts(moveEntry(entries, 1, -1))).toEqual(["b", "a", "c"]);
    expect(texts(moveEntry(entries, 1, 1))).toEqual(["a", "c", "b"]);
  });

  test("past either end is a NO-OP, never a clamp", () => {
    expect(texts(moveEntry(entries, 0, -1))).toEqual(["a", "b", "c"]);
    expect(texts(moveEntry(entries, 2, 1))).toEqual(["a", "b", "c"]);
    expect(texts(moveEntry(entries, 7, -1))).toEqual(["a", "b", "c"]);
  });
});

// --- what the page SHOWS ------------------------------------------------------

describe("glossaryRows", () => {
  const entries = [term("keeper", "Wärter"), term("Abyss", "Abgrund"), term("mire", "Moor")];

  test("alphabetical, and every row keeps its STORED position", () => {
    const shown = glossaryRows(entries);
    expect(shown.map((r) => r.entry.term)).toEqual(["Abyss", "keeper", "mire"]);
    // Position, not display index — this is what a save/delete addresses.
    expect(shown.map((r) => r.index)).toEqual([1, 0, 2]);
  });

  test("the filter reads term AND explanation, case-insensitively", () => {
    expect(glossaryRows(entries, "KEEP").map((r) => r.entry.term)).toEqual(["keeper"]);
    expect(glossaryRows(entries, "moor").map((r) => r.entry.term)).toEqual(["mire"]);
    expect(glossaryRows(entries, "  ").map((r) => r.entry.term)).toHaveLength(3);
  });

  test("a filtered row still points at the stored position it edits", () => {
    // The bug this guards: deleting „mire" by its index in the FILTERED list
    // (0) would have deleted „keeper" (stored position 0).
    expect(glossaryRows(entries, "mire")[0]?.index).toBe(2);
  });

  test("no match is an empty list, not the whole list", () => {
    expect(glossaryRows(entries, "zzz")).toEqual([]);
  });
});

describe("knowledgeRows", () => {
  const entries = [naming("Salt Harbour", "Salzhafen"), fact("Der Turm ist leer.")];

  test("STORED order is kept — it is the order of the prompt", () => {
    expect(knowledgeRows(entries).map((r) => r.index)).toEqual([0, 1]);
  });

  test("the filter reads all three columns", () => {
    expect(knowledgeRows(entries, "salzhafen")).toHaveLength(1);
    expect(knowledgeRows(entries, "turm")[0]?.index).toBe(1);
    expect(knowledgeRows(entries, "harbour")[0]?.index).toBe(0);
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

  test("an empty entry has no summary — the row falls back to its placeholder", () => {
    expect(knowledgeSummary(naming("", ""))).toBe("");
    expect(knowledgeSummary(fact("  "))).toBe("");
  });

  test("a fact or style is its own sentence", () => {
    expect(knowledgeSummary(fact("Der Turm ist leer."))).toBe("Der Turm ist leer.");
  });
});

// --- what is worth saving -----------------------------------------------------

describe("what is worth saving", () => {
  test("a glossary entry needs a term; the explanation may be empty", () => {
    expect(isSendableGlossaryEntry(term("keeper"))).toBe(true);
    expect(isSendableGlossaryEntry(term("  ", "Wärter"))).toBe(false);
  });

  test("a naming entry with HALF a pair is still saved — the DM is mid-typing", () => {
    expect(isSendableKnowledgeEntry(naming("Salt Harbour", ""))).toBe(true);
    expect(isSendableKnowledgeEntry(naming("", "Salzhafen"))).toBe(true);
    expect(isSendableKnowledgeEntry(naming("", " "))).toBe(false);
  });

  test("a fact or style entry needs its sentence", () => {
    expect(isSendableKnowledgeEntry(fact("Der Turm ist leer."))).toBe(true);
    expect(isSendableKnowledgeEntry(fact("   "))).toBe(false);
  });

  test("the empty entries are what „Neuer Eintrag“ opens", () => {
    expect(emptyGlossaryEntry()).toEqual({ term: "", explanation: "" });
    // `naming` is the default kind — the one the ticket is about.
    expect(emptyKnowledgeEntry()).toEqual({ kind: "naming", from: "", to: "", text: "" });
    expect(emptyKnowledgeEntry("style").kind).toBe("style");
  });
});

describe("isEntryDirty", () => {
  test("an untouched open entry is not dirty", () => {
    const stored = term("a", "x");
    expect(isEntryDirty({ ...stored }, stored)).toBe(false);
  });

  test("any changed field is dirty", () => {
    expect(isEntryDirty(term("a", "y"), term("a", "x"))).toBe(true);
  });

  test("a NEW entry has no stored counterpart — an empty one is not dirty yet", () => {
    expect(isEntryDirty(emptyGlossaryEntry(), undefined)).toBe(true);
    // …but the page only arms „Speichern" via isSendable, so an untouched
    // new entry cannot be saved either way.
    expect(isSendableGlossaryEntry(emptyGlossaryEntry())).toBe(false);
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
  });

  test("an empty list is zero, not undefined", () => {
    expect(promptKnowledgeCount([])).toBe(0);
  });
});

// --- where the keyboard lands after a deletion (review of #53) --------------

describe("focusAfterRemove", () => {
  test("a middle row hands the focus to the row that takes its place", () => {
    expect(focusAfterRemove(3, 0)).toEqual({ target: "row", index: 0 });
    expect(focusAfterRemove(3, 1)).toEqual({ target: "row", index: 1 });
  });

  test("the LAST row hands it back to the one above", () => {
    expect(focusAfterRemove(3, 2)).toEqual({ target: "row", index: 1 });
    expect(focusAfterRemove(2, 1)).toEqual({ target: "row", index: 0 });
  });

  test("the only row leaves no row — „Neuer Eintrag“ takes the focus", () => {
    expect(focusAfterRemove(1, 0)).toEqual({ target: "add" });
  });

  test("out of range never invents a row", () => {
    expect(focusAfterRemove(0, 0)).toEqual({ target: "add" });
    expect(focusAfterRemove(2, 5)).toEqual({ target: "add" });
  });
});

// --- switching the kind (review of #53) -------------------------------------

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

  test("the columns of the OLD kind are EMPTIED — nothing invisible survives", () => {
    const switched = switchKnowledgeKind(naming("A", "B"), "fact");
    expect(switched.from).toBe("");
    expect(switched.to).toBe("");
    const back = switchKnowledgeKind(switched, "naming");
    expect(back.text).toBe("");
    expect(back.from).toBe("A → B");
  });

  test("switching to the same kind is the identical entry", () => {
    const entry = fact("Bleibt.");
    expect(switchKnowledgeKind(entry, "fact")).toBe(entry);
  });

  test("what survives a round trip is still worth saving", () => {
    const once = switchKnowledgeKind(fact("Salt Harbour"), "naming");
    expect(isSendableKnowledgeEntry(once)).toBe(true);
    expect(isSendableKnowledgeEntry(switchKnowledgeKind(once, "fact"))).toBe(true);
  });
});

describe("isIncompleteNamingEntry", () => {
  test("exactly one half of the pair is incomplete", () => {
    expect(isIncompleteNamingEntry(naming("Salt Harbour", ""))).toBe(true);
    expect(isIncompleteNamingEntry(naming("", "Salzhafen"))).toBe(true);
  });

  test("both halves, or neither, is not", () => {
    expect(isIncompleteNamingEntry(naming("Salt Harbour", "Salzhafen"))).toBe(false);
    expect(isIncompleteNamingEntry(naming("", ""))).toBe(false);
  });

  test("only a naming rule can be incomplete", () => {
    expect(isIncompleteNamingEntry(fact(""))).toBe(false);
  });
});
