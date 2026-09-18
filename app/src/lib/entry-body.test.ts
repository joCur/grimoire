// The two rules of the reading view's edit mode: which entries offer it, and
// when there is something to save. The write itself is the shared editing
// session (lib/use-entry-edit.ts), so nothing here talks to the server.

import { describe, expect, test } from "bun:test";

import { canEditEntryBody, hasBodyChanges } from "./entry-body";

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

describe("canEditEntryBody", () => {
  test("the maintained prose kinds are editable", () => {
    for (const kind of ["scene", "npc", "location", "chapter", "glossary", "unknown"] as const) {
      expect(canEditEntryBody(kind)).toBe(true);
    }
  });

  test("the append-only kinds and the campaign entry are not", () => {
    // Logs and the inbox are append-only by design; the campaign entry has its
    // own edit action for name and description.
    expect(canEditEntryBody("session")).toBe(false);
    expect(canEditEntryBody("inbox")).toBe(false);
    expect(canEditEntryBody("campaign")).toBe(false);
  });
});
