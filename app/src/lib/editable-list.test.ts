// The list arithmetic of the editable list: rows named by their id, the
// order as a list of ids, and where the keyboard lands after a deletion.

import { describe, expect, test } from "bun:test";

import { focusAfterRemove, inOrder, isChanged, moveId, withoutRow, withRow } from "./editable-list";

const row = (id: string, text = id) => ({ id, text });

describe("a row by its id", () => {
  test("a written row takes its own place, a new one goes to the end", () => {
    const rows = [row("a"), row("b")];
    expect(withRow(rows, row("a", "A"))).toEqual([row("a", "A"), row("b")]);
    expect(withRow(rows, row("c"))).toEqual([row("a"), row("b"), row("c")]);
    expect(withRow(undefined, row("a"))).toEqual([row("a")]);
  });

  test("a deleted row leaves by its id, whatever its position", () => {
    expect(withoutRow([row("a"), row("b"), row("c")], "b")).toEqual([row("a"), row("c")]);
    expect(withoutRow([row("a")], "nope")).toEqual([row("a")]);
  });
});

describe("the order", () => {
  const ids = ["a", "b", "c"];

  test("up and down swap with the neighbour", () => {
    expect(moveId(ids, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(ids, "b", 1)).toEqual(["a", "c", "b"]);
  });

  test("past either end, or an unknown id, is a NO-OP — never a clamp", () => {
    expect(moveId(ids, "a", -1)).toEqual(ids);
    expect(moveId(ids, "c", 1)).toEqual(ids);
    expect(moveId(ids, "nope", 1)).toEqual(ids);
  });

  test("rows follow the order of their ids", () => {
    expect(inOrder([row("a"), row("b"), row("c")], ["c", "a", "b"]).map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("isChanged", () => {
  test("an untouched open row is not changed, any changed field is", () => {
    expect(isChanged({ term: "a", explanation: "x" }, { term: "a", explanation: "x" })).toBe(false);
    expect(isChanged({ term: "a", explanation: "x" }, { term: "a", explanation: "y" })).toBe(true);
  });
});

describe("focusAfterRemove", () => {
  // `remaining`/`shown` are both read off the list AS IT LOOKS AFTERWARDS —
  // deleting the 2nd of 3 rows leaves 2, and the row now in display position
  // 1 is the one that took the gap.
  test("a middle row hands the focus to the row that takes its place", () => {
    expect(focusAfterRemove(2, 0)).toEqual({ target: "row", index: 0 });
    expect(focusAfterRemove(2, 1)).toEqual({ target: "row", index: 1 });
  });

  test("the LAST row hands it back to the one above", () => {
    expect(focusAfterRemove(2, 2)).toEqual({ target: "row", index: 1 });
    expect(focusAfterRemove(1, 1)).toEqual({ target: "row", index: 0 });
  });

  test("the only row leaves no row — the add button takes the focus", () => {
    expect(focusAfterRemove(0, 0)).toEqual({ target: "add" });
  });

  test("out of range never invents a row", () => {
    expect(focusAfterRemove(0, 3)).toEqual({ target: "add" });
    expect(focusAfterRemove(2, 9)).toEqual({ target: "row", index: 1 });
    expect(focusAfterRemove(2, -1)).toEqual({ target: "row", index: 0 });
  });
});
