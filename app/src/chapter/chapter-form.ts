// The form of a chapter — what the edit mode of its reading view starts with,
// and the write a save sends. Pure, so every rule is unit-testable.
//
// Only what the DM CHANGED is written: a field nobody touched keeps its
// stored value, and whitespace around a value is no change. A chapter always
// has a title, so a blank title is no save; its status is one of the closed
// list, and a chapter without one reads as `planned` until the DM picks one.

import type { ChapterChange, ChapterProposal } from "@grimoire/shared/chapter";

import { textValue } from "@/components/fields/text";

import { isChapterStatus } from "./chapter-status";

/**
 * The form's values, one text per field — typed against the chapter, so a
 * field the form does not handle does not compile. `id` is fixed at creation
 * (decisions/constraints) and `body` is the edit mode's text draft.
 */
export type ChapterFormValues = {
  [K in Exclude<keyof ChapterProposal, "id" | "body">]-?: string;
};

const FIELDS = {
  title: true,
  status: true,
} satisfies Record<keyof ChapterFormValues, true>;

const KEYS = Object.keys(FIELDS) as Array<keyof ChapterFormValues>;

/** What the form starts with — the chapter's current values. */
export function chapterFormValues(chapter: ChapterProposal): ChapterFormValues {
  return { title: chapter.title, status: chapter.status ?? "" };
}

/** The fields whose written value moved, blank title included. */
function moved(initial: ChapterFormValues, values: ChapterFormValues) {
  return KEYS.filter((key) => textValue(initial[key]) !== textValue(values[key]));
}

/** The write: ONLY the fields that moved; a blank title is left out. */
export function chapterFormChange(
  initial: ChapterFormValues,
  values: ChapterFormValues,
): ChapterChange {
  const change: ChapterChange = {};
  for (const key of moved(initial, values)) {
    const value = textValue(values[key]);
    if (value === null) continue;
    if (key === "title") change.title = value;
    else if (isChapterStatus(value)) change.status = value;
  }
  return change;
}

/** Is there typed work a close would lose? */
export function chapterFormDirty(initial: ChapterFormValues, values: ChapterFormValues): boolean {
  return moved(initial, values).length > 0;
}

/** A blank title is not a save — the chapter would lose its name. */
export function canSubmitChapterForm(values: ChapterFormValues): boolean {
  return textValue(values.title) !== null;
}
