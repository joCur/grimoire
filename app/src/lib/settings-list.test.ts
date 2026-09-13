// The list mechanics of the settings page's two campaign editors (issue #53).
//
// All pure, so the interesting rules — what survives a reorder, what is worth
// sending, when the save button is armed — are asserted without a DOM.

import { describe, expect, test } from "bun:test";
import type { GlossaryEntry, KnowledgeEntry } from "@grimoire/shared/types";

import {
  appendRow,
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
