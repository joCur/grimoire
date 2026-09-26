// The chapter status enum in the app: labels from the catalog, and the one
// write every value takes.

import { CHAPTER_STATUSES, type ChapterStatus } from "@grimoire/shared/chapter";
import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n";

import {
  CHAPTER_STATUS_DEFAULT,
  chapterStatusOptions,
  chapterStatusPatchBody,
  chapterStatusValue,
  isChapterStatus,
} from "./chapter-status";

const t = translator("de");
const tEn = translator("en");

describe("the enum", () => {
  test("is exactly the trio the API accepts, in lifecycle order", () => {
    expect([...CHAPTER_STATUSES]).toEqual(["planned", "active", "done"]);
    expect(CHAPTER_STATUS_DEFAULT).toBe("planned");
  });

  test("knows its own members and nothing else", () => {
    for (const status of CHAPTER_STATUSES) expect(isChapterStatus(status)).toBe(true);
    expect(isChapterStatus("laeuft")).toBe(false);
    expect(isChapterStatus("")).toBe(false);
  });
});

describe("labels", () => {
  test("the German labels", () => {
    expect(chapterStatusOptions(t).map((o) => o.label)).toEqual([
      "Geplant",
      "Aktiv",
      "Abgeschlossen",
    ]);
  });

  test("and the English ones", () => {
    expect(chapterStatusOptions(tEn).map((o) => o.label)).toEqual(["Planned", "Active", "Done"]);
  });

  test("the option VALUES are the wire values, never translated", () => {
    expect(chapterStatusOptions(t).map((o) => o.value)).toEqual([...CHAPTER_STATUSES]);
    expect(chapterStatusOptions(tEn).map((o) => o.value)).toEqual([...CHAPTER_STATUSES]);
  });

  test("a value from outside the trio is not a status at all", () => {
    // The column is a CHECK constraint, so the database cannot hold anything
    // else (ADR #25); the type is what says so, so the renderer has nothing
    // to fall back for.
    // @ts-expect-error not one of planned | active | done
    const foreign: ChapterStatus = "laeuft";
    expect(CHAPTER_STATUSES as readonly string[]).not.toContain(foreign);
  });

  test("no status reads as planned — every creation path writes it", () => {
    expect(chapterStatusValue(undefined)).toBe("planned");
    expect(chapterStatusValue("done")).toBe("done");
  });
});

describe("the write", () => {
  test("every value is one patch of the chapter's status, against its rev", () => {
    // `active` is no exception: the server takes it off the chapter that held
    // it in the same transaction, so the request only names this chapter.
    for (const status of CHAPTER_STATUSES) {
      expect(chapterStatusPatchBody(7, status)).toEqual({ rev: 7, status });
    }
  });
});
