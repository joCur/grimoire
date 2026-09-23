// The rules of the reading view's edit mode: whether there is something to
// save, and what one save carries. The write itself is the shared editing session
// (lib/use-entry-edit.ts), so nothing here talks to the server.

import { describe, expect, test } from "bun:test";

import { bodyEditorWrite, hasBodyChanges } from "./entry-body";

describe("hasBodyChanges", () => {
  test("identical text is nothing to save", () => {
    expect(hasBodyChanges("## Flow\n\nText.\n", "## Flow\n\nText.\n")).toBe(false);
  });

  test("whitespace counts — two trailing spaces are a markdown line break", () => {
    expect(hasBodyChanges("Zeile\n", "Zeile  \n")).toBe(true);
    expect(hasBodyChanges("Text.\n", "Text.\n\n")).toBe(true);
  });

  test("edited text is a change", () => {
    expect(hasBodyChanges("Text.\n", "Anderer Text.\n")).toBe(true);
  });
});

describe("bodyEditorWrite", () => {
  test("only the halves that changed travel — an untouched text stays out", () => {
    expect(bodyEditorWrite("Text.\n", "Text.\n", {})).toEqual({});
    expect(bodyEditorWrite("Text.\n", "Neu.\n", {})).toEqual({ body: "Neu.\n" });
    expect(bodyEditorWrite("Text.\n", "Text.\n", { motivation: "Ruhe." })).toEqual({
      properties: { motivation: "Ruhe." },
    });
  });

  test("text and prose property together are ONE write; `null` clears the field", () => {
    expect(bodyEditorWrite("Alt.\n", "Neu.\n", { motivation: null })).toEqual({
      body: "Neu.\n",
      properties: { motivation: null },
    });
  });
});
