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
    for (const kind of ["scene", "npc", "location", "chapter", "unknown"] as const) {
      expect(canEditEntryBody(kind)).toBe(true);
    }
  });

  test("the campaign entry is prose like a chapter", () => {
    // Its name and description stay with the campaign dialog; the text below
    // them is written like any other entry's.
    expect(canEditEntryBody("campaign")).toBe(true);
  });

  test("the append-only kinds are not", () => {
    // Logs and the inbox are append-only by design; a free-hand rewrite of a
    // log is not a maintenance action.
    expect(canEditEntryBody("session")).toBe(false);
    expect(canEditEntryBody("inbox")).toBe(false);
  });

  test("the glossary is a list — no text editor", () => {
    // It is maintained row by row on its own page, and the write path answers a
    // body for it with 400 `body_not_editable` (ADR #23): an editor here could
    // only offer a save that never succeeds.
    expect(canEditEntryBody("glossary")).toBe(false);
  });
});
