// The chapter edit rules — the pure half of ChapterActions.

import { describe, expect, test } from "bun:test";

import { chapterBodyChanged, chapterBodyToWrite, chapterMetaPath } from "@/lib/chapter-meta";

describe("chapterMetaPath", () => {
  test("addresses the chapter's own entry", () => {
    expect(chapterMetaPath("01-salzhafen")).toBe("01-salzhafen");
  });
});

describe("chapterBodyToWrite", () => {
  test("keeps the text and ends it with exactly one newline", () => {
    expect(chapterBodyToWrite("Ankommen.\n\nUnd bleiben.")).toBe("Ankommen.\n\nUnd bleiben.\n");
    expect(chapterBodyToWrite("## Ziel\n\nAnkommen.\n\n\n")).toBe("## Ziel\n\nAnkommen.\n");
  });

  test("blank text is the empty string, not whitespace", () => {
    // "" is what the overview and the reading view read as „no text"; three
    // newlines would render as an empty block instead.
    expect(chapterBodyToWrite("")).toBe("");
    expect(chapterBodyToWrite("\n\n  \n")).toBe("");
  });
});

describe("chapterBodyChanged", () => {
  test("whitespace-only differences are not a change — nothing to save", () => {
    expect(chapterBodyChanged("## Ziel\n\nAnkommen.", "## Ziel\n\nAnkommen.\n")).toBe(false);
    expect(chapterBodyChanged("   ", "")).toBe(false);
  });

  test("real text is", () => {
    expect(chapterBodyChanged("## Ziel\n\nAnkommen.", "## Ziel\n\nAbreisen.")).toBe(true);
    expect(chapterBodyChanged("## Ziel\n\nAnkommen.", "")).toBe(true);
  });
});
