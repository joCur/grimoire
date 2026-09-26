// The rules of a chapter's form: what the edit mode starts with, and the
// change that decides what is written at all.

import type { ChapterProposal } from "@grimoire/shared/chapter";
import { describe, expect, test } from "bun:test";

import {
  canSubmitChapterForm,
  chapterFormChange,
  chapterFormDirty,
  chapterFormValues,
} from "./chapter-form";

const CHAPTER: ChapterProposal = {
  id: "01-salt-harbour",
  title: "Salt Harbour",
  status: "planned",
  body: "Arriving.\n",
};
const initial = chapterFormValues(CHAPTER);

describe("chapterFormValues", () => {
  test("a chapter starts with its title and its status, never its id or text", () => {
    expect(initial).toEqual({ title: "Salt Harbour", status: "planned" });
  });

  test("a chapter without a status starts without one", () => {
    const { status: _status, ...withoutStatus } = CHAPTER;
    expect(chapterFormValues(withoutStatus).status).toBe("");
  });
});

describe("chapterFormChange", () => {
  test("an untouched form writes nothing at all", () => {
    expect(chapterFormChange(initial, initial)).toEqual({});
    expect(chapterFormDirty(initial, initial)).toBe(false);
  });

  test("only the changed field is sent, whitespace around it is no change", () => {
    expect(chapterFormChange(initial, { ...initial, status: "done" })).toEqual({ status: "done" });
    expect(chapterFormChange(initial, { ...initial, title: "  Salt Harbour " })).toEqual({});
  });

  test("making a chapter active is an ordinary field change", () => {
    // The server puts the chapter that held `active` back to planned — the
    // edit mode only says what this chapter becomes.
    expect(chapterFormChange(initial, { ...initial, status: "active" })).toEqual({
      status: "active",
    });
  });

  test("picking a status for a chapter without one writes it", () => {
    const bare = { ...initial, status: "" };
    expect(chapterFormChange(bare, { ...bare, status: "planned" })).toEqual({ status: "planned" });
  });

  test("a blank title is left out of the write", () => {
    expect(chapterFormChange(initial, { ...initial, title: "  " })).toEqual({});
    expect(chapterFormDirty(initial, { ...initial, title: "  " })).toBe(true);
  });
});

describe("canSubmitChapterForm", () => {
  test("a blank title is not a save", () => {
    expect(canSubmitChapterForm(initial)).toBe(true);
    expect(canSubmitChapterForm({ ...initial, title: "  " })).toBe(false);
  });
});
