// The id of the chapter a generator run creates: numeric prefix plus the
// slug of the title, the checks on an id the DM typed instead, and when the
// suggestion still follows the title.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";

import { chapterIdError, chapterIdValue, newChapterId, nextChapterPrefix } from "./chapter-run";

// The copy comes from the catalog and the translator is passed in — so a
// test says which language it asserts.
const t = translator("de");

describe("nextChapterPrefix", () => {
  test("first chapter of an empty campaign", () => {
    expect(nextChapterPrefix([])).toBe("01");
  });

  test("continues after the highest existing prefix", () => {
    expect(nextChapterPrefix(["01-salzhafen"])).toBe("02");
    expect(nextChapterPrefix(["01-a", "02-b", "03-c"])).toBe("04");
  });

  test("gaps and unordered ids do not lower the number", () => {
    expect(nextChapterPrefix(["03-c", "01-a"])).toBe("04");
    expect(nextChapterPrefix(["09-x"])).toBe("10");
  });

  test("keeps the widest existing padding", () => {
    expect(nextChapterPrefix(["001-a", "002-b"])).toBe("003");
  });

  test("chapters without a numeric prefix are ignored", () => {
    expect(nextChapterPrefix(["prolog", "anhang"])).toBe("01");
    expect(nextChapterPrefix(["prolog", "07-see"])).toBe("08");
  });
});

describe("newChapterId", () => {
  test("prefix and slug form the id", () => {
    expect(newChapterId("Die Schmugglerbucht", ["01-salzhafen"])).toBe("02-die-schmugglerbucht");
  });

  test("undefined while the title has no slug yet", () => {
    expect(newChapterId("", ["01-salzhafen"])).toBeUndefined();
    expect(newChapterId("  ", [])).toBeUndefined();
  });
});

describe("chapterIdError", () => {
  test("accepts kebab ids with and without a number prefix", () => {
    expect(chapterIdError("03-schmugglerbucht", t)).toBeUndefined();
    expect(chapterIdError("schmugglerbucht", t)).toBeUndefined();
    expect(chapterIdError("prolog", t)).toBeUndefined();
    expect(chapterIdError("007", t)).toBeUndefined();
    // Every chapter is its own resource: no id collides with a path segment.
    expect(chapterIdError("sessions", t)).toBeUndefined();
  });

  test("rejects an empty id", () => {
    expect(chapterIdError("", t)).toBe("Kapitel-Kennung fehlt.");
  });

  test("rejects path separators", () => {
    expect(chapterIdError("a/b", t)).toContain("Schrägstriche");
    expect(chapterIdError("a\\b", t)).toContain("Schrägstriche");
    expect(chapterIdError("/absolut", t)).toContain("Schrägstriche");
  });

  test("rejects traversal and hidden segments", () => {
    expect(chapterIdError("..", t)).toContain("..");
    expect(chapterIdError("a..b", t)).toContain("..");
    expect(chapterIdError(".versteckt", t)).toContain("Punkt am Anfang");
  });

  test("rejects whitespace anywhere", () => {
    expect(chapterIdError("03 schmugglerbucht", t)).toContain("Leerzeichen");
    expect(chapterIdError(" 03-bucht", t)).toContain("Leerzeichen");
    expect(chapterIdError("03-bucht ", t)).toContain("Leerzeichen");
    expect(chapterIdError("   ", t)).toContain("Leerzeichen");
    expect(chapterIdError("03-bucht\t", t)).toContain("Leerzeichen");
  });

  test("rejects anything outside lowercase kebab — no silent rewrite", () => {
    const charset = "Nur Kleinbuchstaben, Ziffern und Bindestriche.";
    expect(chapterIdError("03-Schmugglerbucht", t)).toBe(charset);
    expect(chapterIdError("03-schmüggler", t)).toBe(charset);
    expect(chapterIdError("03_bucht", t)).toBe(charset);
    expect(chapterIdError("bucht.md", t)).toBe(charset);
    expect(chapterIdError("bucht\0", t)).toBe(charset);
  });

});

describe("chapterIdValue", () => {
  test("follows the title while the field is untouched", () => {
    expect(chapterIdValue("02-die-schmugglerbucht", undefined)).toBe("02-die-schmugglerbucht");
    expect(chapterIdValue(undefined, undefined)).toBe("");
  });

  test("a manual value wins over the suggestion", () => {
    expect(chapterIdValue("02-die-schmugglerbucht", "03-bucht")).toBe("03-bucht");
    // …even when the title yields no suggestion at all.
    expect(chapterIdValue(undefined, "03-bucht")).toBe("03-bucht");
  });

  test("the suggestion follows the title only until the first manual edit", () => {
    const ids = ["01-salzhafen"];
    // Typing the title: the field mirrors the suggestion.
    let manual: string | undefined;
    expect(chapterIdValue(newChapterId("Die Bucht", ids), manual)).toBe("02-die-bucht");
    // The DM edits the id — from here the title no longer moves it.
    manual = "07-bucht";
    expect(chapterIdValue(newChapterId("Die Bucht", ids), manual)).toBe("07-bucht");
    expect(chapterIdValue(newChapterId("Ganz anderer Titel", ids), manual)).toBe("07-bucht");
    // Clearing the field (the view maps "" back to undefined) hands it back.
    manual = undefined;
    expect(chapterIdValue(newChapterId("Ganz anderer Titel", ids), manual)).toBe(
      "02-ganz-anderer-titel",
    );
  });
});
