// The rules of the reading view's text editor: whether there is something to
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
  test("only a changed text travels — an untouched text stays out", () => {
    expect(bodyEditorChange("Text.\n", "Text.\n")).toEqual({});
    expect(bodyEditorChange("Text.\n", "New.\n")).toEqual({ body: "New.\n" });
    expect(hasBodyEditChange({})).toBe(false);
    expect(hasBodyEditChange({ body: "" })).toBe(true);
  });
});
