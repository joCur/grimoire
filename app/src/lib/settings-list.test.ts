// The list mechanics of the settings page's two campaign editors (issue #53).
//
// All pure, so the interesting rules — what survives a reorder, what is worth
// sending, when the save button is armed — are asserted without a DOM.

import { describe, expect, test } from "bun:test";
import type { GlossaryEntry, KnowledgeEntry } from "@grimoire/shared/types";

import {
  appendRow,
  focusAfterRemove,
  isIncompleteNamingEntry,
  listId,
  seedDraft,
  switchKnowledgeKind,
  syncDraft,
  emptyGlossaryEntry,
  emptyKnowledgeEntry,
  fromRows,
  isDirty,
  isSendableGlossaryEntry,
  isSendableKnowledgeEntry,
  moveRow,
  promptKnowledgeCount,
  removeRow,
  toRows,
  updateRow,
} from "./settings-list";

const naming = (from: string, to: string): KnowledgeEntry => ({ kind: "naming", from, to, text: "" });
const fact = (text: string): KnowledgeEntry => ({ kind: "fact", from: "", to: "", text });

describe("rows", () => {
  test("every row gets its own key, and the keys survive an edit", () => {
    const rows = toRows([{ term: "a", explanation: "" }, { term: "b", explanation: "" }]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    const edited = updateRow(rows, rows[1]!.key, { term: "B" });
    // The key is what keeps the focus in the input being typed in.
    expect(edited.map((r) => r.key)).toEqual(rows.map((r) => r.key));
    expect(fromRows(edited)).toEqual([
      { term: "a", explanation: "" },
      { term: "B", explanation: "" },
    ]);
  });

  test("an edit patches only the named row", () => {
    const rows = toRows([fact("a"), fact("b")]);
    expect(fromRows(updateRow(rows, rows[0]!.key, { text: "A" }))).toEqual([fact("A"), fact("b")]);
  });

  test("remove and append", () => {
    let rows = toRows([fact("a"), fact("b")]);
    rows = removeRow(rows, rows[0]!.key);
    expect(fromRows(rows)).toEqual([fact("b")]);
    rows = appendRow(rows, fact("c"));
    expect(fromRows(rows)).toEqual([fact("b"), fact("c")]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe("moveRow", () => {
  const rows = toRows([fact("a"), fact("b"), fact("c")]);
  const texts = (list: typeof rows) => fromRows(list).map((e) => e.text);

  test("up and down swap with the neighbour", () => {
    expect(texts(moveRow(rows, 1, -1))).toEqual(["b", "a", "c"]);
    expect(texts(moveRow(rows, 1, 1))).toEqual(["a", "c", "b"]);
  });

  test("past either end is a NO-OP, never a clamp", () => {
    expect(texts(moveRow(rows, 0, -1))).toEqual(["a", "b", "c"]);
    expect(texts(moveRow(rows, 2, 1))).toEqual(["a", "b", "c"]);
    expect(texts(moveRow(rows, 7, -1))).toEqual(["a", "b", "c"]);
  });

  test("the moved row keeps its key — a reorder is not a retype", () => {
    const moved = moveRow(rows, 0, 1);
    expect(moved[1]!.key).toBe(rows[0]!.key);
  });
});

describe("what is worth sending", () => {
  test("a glossary row needs a term; the explanation may be empty", () => {
    expect(isSendableGlossaryEntry({ term: "keeper", explanation: "" })).toBe(true);
    expect(isSendableGlossaryEntry({ term: "  ", explanation: "Wärter" })).toBe(false);
  });

  test("a naming row with HALF a pair is still sent — the DM is mid-typing", () => {
    expect(isSendableKnowledgeEntry(naming("Salt Harbour", ""))).toBe(true);
    expect(isSendableKnowledgeEntry(naming("", "Salzhafen"))).toBe(true);
    expect(isSendableKnowledgeEntry(naming("", " "))).toBe(false);
  });

  test("a fact or style row needs its sentence", () => {
    expect(isSendableKnowledgeEntry(fact("Der Turm ist leer."))).toBe(true);
    expect(isSendableKnowledgeEntry(fact("   "))).toBe(false);
  });

  test("the empty entries are what the add button appends", () => {
    expect(emptyGlossaryEntry()).toEqual({ term: "", explanation: "" });
    // `naming` is the default kind — the one the ticket is about.
    expect(emptyKnowledgeEntry()).toEqual({ kind: "naming", from: "", to: "", text: "" });
    expect(emptyKnowledgeEntry("style").kind).toBe("style");
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

describe("isDirty", () => {
  const stored: GlossaryEntry[] = [{ term: "a", explanation: "x" }];

  test("an untouched list is not dirty", () => {
    expect(isDirty(stored, stored)).toBe(false);
  });

  test("a changed value, a new entry and a REORDER are all dirty", () => {
    expect(isDirty([{ term: "a", explanation: "y" }], stored)).toBe(true);
    expect(isDirty([...stored, { term: "b", explanation: "" }], stored)).toBe(true);
    const two: GlossaryEntry[] = [...stored, { term: "b", explanation: "" }];
    expect(isDirty([...two].reverse(), two)).toBe(true);
  });

  test("adding an EMPTY row does not arm the save — it is not sendable", () => {
    // The component compares the sendable payload, which drops that row.
    const sendable = [...stored, emptyGlossaryEntry()].filter(isSendableGlossaryEntry);
    expect(isDirty(sendable, stored)).toBe(false);
  });
});

// --- which server answer may replace the draft (review of #53) --------------

describe("syncDraft", () => {
  const listA = { id: listId(["knowledge", "a"]), rev: 3, entries: [fact("A")] };
  const listB = { id: listId(["knowledge", "b"]), rev: 3, entries: [fact("B")] };

  test("with no draft yet the server's list is taken", () => {
    const sync = syncDraft(undefined, listA, false);
    expect(sync.action).toBe("seed");
    expect(sync.action === "seed" && fromRows(sync.draft.rows)).toEqual([fact("A")]);
  });

  test("a DIFFERENT list is always reseeded — even with unsaved changes", () => {
    // `?from=a` -> `?from=b`. Keeping A's rows here is how A's entries would
    // get saved under B; the two lists happen to share a rev, so the rev
    // alone cannot tell them apart. The draft is discarded, not migrated.
    const draft = seedDraft(listA);
    const sync = syncDraft(draft, listB, true);
    expect(sync.action).toBe("seed");
    expect(sync.action === "seed" && fromRows(sync.draft.rows)).toEqual([fact("B")]);
    expect(sync.action === "seed" && sync.draft.id).toBe(listB.id);
  });

  test("the SAME list at the same rev is left alone — a refetch is not a reset", () => {
    const draft = seedDraft(listA);
    expect(syncDraft(draft, listA, true).action).toBe("keep");
    expect(syncDraft(draft, listA, false).action).toBe("keep");
  });

  test("a newer rev reseeds an UNTOUCHED draft", () => {
    const draft = seedDraft(listA);
    const sync = syncDraft(draft, { ...listA, rev: 4, entries: [fact("Von woanders")] }, false);
    expect(sync.action).toBe("seed");
    expect(sync.action === "seed" && fromRows(sync.draft.rows)).toEqual([fact("Von woanders")]);
  });

  test("a newer rev over UNSAVED changes is a conflict, never an overwrite", () => {
    const draft = seedDraft(listA);
    expect(syncDraft(draft, { ...listA, rev: 4, entries: [fact("Von woanders")] }, true)).toEqual({
      action: "stale",
    });
  });

  test("a seeded draft carries the server list as its dirty BASELINE", () => {
    const draft = seedDraft(listA);
    expect(draft.base).toEqual([fact("A")]);
    expect(isDirty(fromRows(draft.rows), draft.base)).toBe(false);
  });

  test("the id is campaign AND list — the same list of two campaigns differs", () => {
    expect(listId(["knowledge", "a"])).not.toBe(listId(["knowledge", "b"]));
    expect(listId(["knowledge", "a"])).not.toBe(listId(["glossary", "a"]));
    expect(listId(["knowledge", "a"])).toBe(listId(["knowledge", "a"]));
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

  test("the only row leaves no row — „Eintrag hinzufügen“ takes the focus", () => {
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
    expect(switchKnowledgeKind(fact("Salt Harbour"), "naming")).toEqual(
      naming("Salt Harbour", ""),
    );
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
    // The first version only hid them, which left text in the database that
    // nothing on screen explained.
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

  test("what survives a round trip is still worth sending", () => {
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
