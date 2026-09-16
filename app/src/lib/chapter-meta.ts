// The chapter's own edit rules — pure, so they are testable
// without a dialog.
//
// Why a chapter needs them at all: the create-chapter action asks for a title
// and a goal, and until this slice that was the last time either could be
// said. A chapter created by the boot repair is called by its slug, and a
// chapter created without a goal had no way to get one — the overview listed a
// heading nobody could correct. So the chapter overview gets the campaign
// header's two actions per chapter: the properties dialog for title and
// status, the edit dialog for the chapter body the goal line is read from.
//
// The two halves write through DIFFERENT documented endpoints, which is why
// they are two actions and not one form: the title and the status are
// PROPERTIES (PATCH /properties), the goal is the BODY (PUT /entry). Merging
// them would mean one dialog issuing two guarded writes, i.e. one of them
// landing while the other 409s.

import { fetchEntry, putEntryBody } from "@/api";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

/** Campaign-relative address of a chapter's entry — the chapter id itself. */
export function chapterMetaPath(chapter: string): string {
  return chapter;
}

/** The heading the overview reads a chapter's goal line from (`firstParagraphOfSection`). */
export const CHAPTER_GOAL_HEADING = "Ziel des Kapitels";

/**
 * The body an edit save writes.
 *
 * The dialog edits the WHOLE chapter body as markdown — same field the
 * reading view's editor writes, so nothing can disagree about what a chapter's
 * text is. A body that is blank after trimming is stored as the empty string
 * rather than as whitespace: the overview's goal line and the reading view both
 * treat "" as "no text", and a body of three newlines would render as an empty
 * section instead.
 */
export function chapterBodyToWrite(body: string): string {
  const trimmed = body.trim();
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** Nothing typed and nothing stored — there is no write to make. */
export function chapterBodyChanged(next: string, stored: string): boolean {
  return chapterBodyToWrite(next) !== chapterBodyToWrite(stored);
}

/** The guarded body write, with the 409 re-read of ADR #4. */
export function writeChapterBody(
  campaign: string,
  chapter: string,
  body: string,
  rev: number,
): Promise<RevWriteResult> {
  const path = chapterMetaPath(chapter);
  return writeWithRev(
    () => putEntryBody(campaign, path, chapterBodyToWrite(body), rev),
    () => fetchEntry(campaign, path),
  );
}
