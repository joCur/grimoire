// The rules of the reading view's edit mode: whether there is something to
// save, and what one save carries. The write itself is the kind's editing
// session, so nothing here talks to the server.

import { describe, expect, test } from "bun:test";

import { bodyEditorChange, hasBodyChanges, hasBodyEditChange } from "./body-edit";

describe("hasBodyChanges", () => {
  test("identical text is nothing to save", () => {
    expect(hasBodyChanges("## Flow\n\nText.\n", "## Flow\n\nText.\n")).toBe(false);
  });

  test("whitespace counts — two trailing spaces are a markdown line break", () => {
    expect(hasBodyChanges("Line\n", "Line  \n")).toBe(true);
    expect(hasBodyChanges("Text.\n", "Text.\n\n")).toBe(true);
  });

  test("edited text is a change", () => {
    expect(hasBodyChanges("Text.\n", "Other text.\n")).toBe(true);
  });
});

describe("bodyEditorChange", () => {
  test("only the halves that changed travel — an untouched text stays out", () => {
    expect(bodyEditorChange("Text.\n", "Text.\n", {})).toEqual({});
    expect(bodyEditorChange("Text.\n", "New.\n", {})).toEqual({ body: "New.\n" });
    expect(bodyEditorChange("Text.\n", "Text.\n", { motivation: "Peace." })).toEqual({
      fields: { motivation: "Peace." },
    });
    expect(hasBodyEditChange({})).toBe(false);
    expect(hasBodyEditChange({ body: "" })).toBe(true);
  });

  test("text and prose property together are ONE write; `null` clears the field", () => {
    expect(bodyEditorChange("Old.\n", "New.\n", { motivation: null })).toEqual({
      body: "New.\n",
      fields: { motivation: null },
    });
  });
});
