// The one rule of the reading view's edit mode: whether there is something to
// save. The write itself is the shared editing session
// (lib/use-entry-edit.ts), so nothing here talks to the server.

import { describe, expect, test } from "bun:test";

import { hasBodyChanges } from "./entry-body";

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
