import { describe, expect, test } from "bun:test";

import { rangeText, resultText, rollTable } from "./roll";

const d6 = {
  columns: ["Weather"],
  rows: [
    { min: 1, max: 3, cells: ["Fog"] },
    { min: 4, max: 5, cells: ["Wind"] },
    { min: 6, max: 6, cells: ["Storm"] },
  ],
};

/** A `random` that lands on die result `n` of `sides`. */
const face = (n: number, sides: number) => () => (n - 1) / sides;

describe("rollTable", () => {
  test("every die result lands in the row whose range holds it", () => {
    const rolls = [1, 2, 3, 4, 5, 6].map((n) => rollTable(d6, face(n, 6)));
    expect(rolls).toEqual([
      { row: 0, value: 1 },
      { row: 0, value: 2 },
      { row: 0, value: 3 },
      { row: 1, value: 4 },
      { row: 1, value: 5 },
      { row: 2, value: 6 },
    ]);
  });

  test("a table without dice ranges gives every row the same chance and no number", () => {
    const names = {
      rows: [
        { min: null, max: null, cells: ["Mara"] },
        { min: null, max: null, cells: ["Tobin"] },
      ],
    };
    expect(rollTable(names, () => 0)).toEqual({ row: 0, value: null });
    expect(rollTable(names, () => 0.99)).toEqual({ row: 1, value: null });
  });

  test("an empty table has no roll", () => {
    expect(rollTable({ rows: [] })).toBeUndefined();
  });
});

describe("resultText", () => {
  test("one column is its cell; several name their headings", () => {
    expect(resultText(d6, d6.rows[0]!)).toBe("Fog");
    expect(
      resultText(
        { columns: ["Item", "Description"] },
        { min: 1, max: 1, cells: ["Pearl ring", "Skin turns white."] },
      ),
    ).toBe("Item: Pearl ring; Description: Skin turns white.");
  });
});

describe("rangeText", () => {
  test("a single result or a range, nothing for a row without one", () => {
    expect(rangeText({ min: 6, max: 6, cells: [] })).toBe("6");
    expect(rangeText({ min: 1, max: 3, cells: [] })).toBe("1–3");
    expect(rangeText({ min: null, max: null, cells: [] })).toBe("");
  });
});
