// The rules of a chapter's form: what the dialog starts with, the change that
// decides what is written at all, the representation a cleared status is
// written in, and the text the overview's text dialog writes.

import type { ChapterProposal } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import {
  canSubmitChapterForm,
  chapterBodyChanged,
  chapterBodyToWrite,
  chapterFormChange,
  chapterFormDirty,
  chapterFormValues,
} from "./chapter-form";

const CHAPTER: ChapterProposal = {
  id: "01-salzhafen",
  title: "Salzhafen",
  status: "planned",
  body: "Ankommen.\n",
};
const initial = chapterFormValues(CHAPTER);

describe("chapterFormValues", () => {
  test("a chapter starts with its title and its status, never its id or text", () => {
    expect(initial).toEqual({ title: "Salzhafen", status: "planned" });
  });

  test("a chapter without a status starts with the empty choice", () => {
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
    expect(chapterFormChange(initial, { ...initial, title: "  Salzhafen " })).toEqual({});
  });

  test("making a chapter active is an ordinary field change", () => {
    // The server puts the chapter that held `active` back to planned — the
    // dialog only says what this chapter becomes.
    expect(chapterFormChange(initial, { ...initial, status: "active" })).toEqual({
      status: "active",
    });
  });

  test("clearing the status sends null", () => {
    expect(chapterFormChange(initial, { ...initial, status: "" })).toEqual({ status: null });
    expect(chapterFormDirty(initial, { ...initial, status: "" })).toBe(true);
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

describe("chapterBodyToWrite", () => {
  test("keeps the text and ends it with exactly one newline", () => {
    expect(chapterBodyToWrite("Ankommen.\n\nUnd bleiben.")).toBe("Ankommen.\n\nUnd bleiben.\n");
    expect(chapterBodyToWrite("## Ziel\n\nAnkommen.\n\n\n")).toBe("## Ziel\n\nAnkommen.\n");
  });

  test("blank text is the empty string, not whitespace", () => {
    // "" is what the overview and the reading view read as "no text"; three
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
