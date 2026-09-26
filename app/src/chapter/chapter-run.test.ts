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
    expect(nextChapterPrefix(["01-salt-harbour"])).toBe("02");
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
    expect(nextChapterPrefix(["prologue", "appendix"])).toBe("01");
    expect(nextChapterPrefix(["prologue", "07-lake"])).toBe("08");
  });
});

describe("newChapterId", () => {
  test("prefix and slug form the id", () => {
    expect(newChapterId("The Smuggler Cove", ["01-salt-harbour"])).toBe("02-the-smuggler-cove");
  });

  test("undefined while the title has no slug yet", () => {
    expect(newChapterId("", ["01-salt-harbour"])).toBeUndefined();
    expect(newChapterId("  ", [])).toBeUndefined();
  });
});

describe("chapterIdError", () => {
  test("accepts kebab ids with and without a number prefix", () => {
    expect(chapterIdError("03-smuggler-cove", t)).toBeUndefined();
    expect(chapterIdError("smuggler-cove", t)).toBeUndefined();
    expect(chapterIdError("prologue", t)).toBeUndefined();
    expect(chapterIdError("007", t)).toBeUndefined();
    // Every chapter is its own resource: no id collides with a path segment.
    expect(chapterIdError("sessions", t)).toBeUndefined();
  });

  test("rejects an empty id", () => {
    expect(chapterIdError("", t)).toBe(t("generate.input.chapterId.missing"));
  });

  test("rejects path separators", () => {
    expect(chapterIdError("a/b", t)).toBe(t("generate.input.chapterId.slash"));
    expect(chapterIdError("a\\b", t)).toBe(t("generate.input.chapterId.slash"));
    expect(chapterIdError("/absolute", t)).toBe(t("generate.input.chapterId.slash"));
  });

  test("rejects traversal and hidden segments", () => {
    expect(chapterIdError("..", t)).toBe(t("generate.input.chapterId.dots"));
    expect(chapterIdError("a..b", t)).toBe(t("generate.input.chapterId.dots"));
    expect(chapterIdError(".hidden", t)).toBe(t("generate.input.chapterId.leadingDot"));
  });

  test("rejects whitespace anywhere", () => {
    expect(chapterIdError("03 smuggler-cove", t)).toBe(t("generate.input.chapterId.space"));
    expect(chapterIdError(" 03-cove", t)).toBe(t("generate.input.chapterId.space"));
    expect(chapterIdError("03-cove ", t)).toBe(t("generate.input.chapterId.space"));
    expect(chapterIdError("   ", t)).toBe(t("generate.input.chapterId.space"));
    expect(chapterIdError("03-cove\t", t)).toBe(t("generate.input.chapterId.space"));
  });

  test("rejects anything outside lowercase kebab — no silent rewrite", () => {
    const charset = t("generate.input.chapterId.charset");
    expect(chapterIdError("03-Smuggler-Cove", t)).toBe(charset);
    expect(chapterIdError("03-café", t)).toBe(charset);
    expect(chapterIdError("03_cove", t)).toBe(charset);
    expect(chapterIdError("cove.md", t)).toBe(charset);
    expect(chapterIdError("cove\0", t)).toBe(charset);
  });
});

describe("chapterIdValue", () => {
  test("follows the title while the field is untouched", () => {
    expect(chapterIdValue("02-the-smuggler-cove", undefined)).toBe("02-the-smuggler-cove");
    expect(chapterIdValue(undefined, undefined)).toBe("");
  });

  test("a manual value wins over the suggestion", () => {
    expect(chapterIdValue("02-the-smuggler-cove", "03-cove")).toBe("03-cove");
    // …even when the title yields no suggestion at all.
    expect(chapterIdValue(undefined, "03-cove")).toBe("03-cove");
  });

  test("the suggestion follows the title only until the first manual edit", () => {
    const ids = ["01-salt-harbour"];
    // Typing the title: the field mirrors the suggestion.
    let manual: string | undefined;
    expect(chapterIdValue(newChapterId("The Cove", ids), manual)).toBe("02-the-cove");
    // The DM edits the id — from here the title no longer moves it.
    manual = "07-cove";
    expect(chapterIdValue(newChapterId("The Cove", ids), manual)).toBe("07-cove");
    expect(chapterIdValue(newChapterId("Quite Another Title", ids), manual)).toBe("07-cove");
    // Clearing the field (the view maps "" back to undefined) hands it back.
    manual = undefined;
    expect(chapterIdValue(newChapterId("Quite Another Title", ids), manual)).toBe(
      "02-quite-another-title",
    );
  });
});
