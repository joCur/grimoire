// The form of a chapter — what its dialog starts with and the write a save
// sends, and the rule for the text the overview's text dialog writes. Pure,
// so every rule is unit-testable.
//
// Only what the DM CHANGED is written: a field nobody touched keeps its
// stored value, whitespace around a value is no change, and a status set back
// to "not set" clears it (`null`). The title is the exception — a chapter
// always has one, so a blank title is no save.

import type { ChapterChange, ChapterProposal } from "@grimoire/shared/chapter";

import { textValue } from "@/components/fields/text";

import { isChapterStatus } from "./chapter-status";

/**
 * The form's values, one text per field — typed against the chapter, so a
 * field the form does not handle does not compile. `id` is fixed at creation
 * (ADR #21) and `body` has its own editor.
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
    if (key === "title") {
      if (value !== null) change.title = value;
    } else if (value === null) {
      change.status = null;
    } else if (isChapterStatus(value)) {
      change.status = value;
    }
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

/**
 * The text the overview's text dialog writes.
 *
 * The dialog edits the WHOLE chapter text as markdown — the same field the
 * reading view's editor writes, so nothing can disagree about what a chapter's
 * text is. Text that is blank after trimming is stored as the empty string
 * rather than as whitespace: the overview and the reading view both treat ""
 * as "no text", and three newlines would render as an empty block instead.
 */
export function chapterBodyToWrite(body: string): string {
  const trimmed = body.trim();
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** Nothing typed and nothing stored — there is no write to make. */
export function chapterBodyChanged(next: string, stored: string): boolean {
  return chapterBodyToWrite(next) !== chapterBodyToWrite(stored);
}
