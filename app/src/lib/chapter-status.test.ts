// The chapter status enum in the app: labels from the catalog and WHICH write
// one value takes.
//
// The last one is the point of this module. Two of the three values are an
// ordinary rev-guarded properties patch; `active` is the swap endpoint,
// because it is one decision about two chapters. Getting that branch wrong is
// invisible in the UI and produces a campaign with two active chapters.

import { CHAPTER_STATUSES, type ChapterStatus } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n";
import {
  CHAPTER_STATUS_DEFAULT,
  chapterStatusMeta,
  chapterStatusNeedsSwap,
  chapterStatusOptions,
  chapterStatusValue,
  chapterStatusWritable,
  isChapterStatus,
} from "@/lib/chapter-status";

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
    // The column is a CHECK constraint and the preflight refuses a database
    // that holds anything else (ADR #25); the type is what says so, so the
    // renderer has nothing to fall back for.
    // @ts-expect-error not one of planned | active | done
    const foreign: ChapterStatus = "laeuft";
    expect(CHAPTER_STATUSES as readonly string[]).not.toContain(foreign);
  });

  test("no status reads as planned — every creation path writes it", () => {
    expect(chapterStatusValue(undefined)).toBe("planned");
    expect(chapterStatusValue("done")).toBe("done");
  });
});

describe("which write a value takes", () => {
  test("only `active` is the swap", () => {
    expect(chapterStatusNeedsSwap("active")).toBe(true);
    expect(chapterStatusNeedsSwap("planned")).toBe(false);
    expect(chapterStatusNeedsSwap("done")).toBe(false);
  });

  test("the swap needs no rev, a patch does", () => {
    // An overview row carries no rev until its control opens and fetches the
    // chapter entry — „Aktiv" must stay available even if that read fails.
    expect(chapterStatusWritable("active", undefined)).toBe(true);
    expect(chapterStatusWritable("planned", undefined)).toBe(false);
    expect(chapterStatusWritable("done", undefined)).toBe(false);
    expect(chapterStatusWritable("planned", 3)).toBe(true);
  });

  test("the chapter that already holds the flag is never set active again", () => {
    // The swap moves a SECOND chapter, so re-asserting `active` for the one
    // whose control still reads „Aktiv" takes the flag away from the chapter
    // the DM just picked.
    expect(chapterStatusWritable("active", undefined, "active")).toBe(false);
    expect(chapterStatusWritable("active", 3, "active")).toBe(false);
    // Every other row may still ask for it, with or without a rev.
    expect(chapterStatusWritable("active", undefined, "planned")).toBe(true);
    expect(chapterStatusWritable("active", undefined, "done")).toBe(true);
    // The patch branch is unaffected — `done` on the active chapter is an
    // ordinary, legitimate write.
    expect(chapterStatusWritable("done", 3, "active")).toBe(true);
  });
});
