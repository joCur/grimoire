// The chapter's own edit rules — pure, so they are testable without a dialog.
//
// Why a chapter needs them at all: the create action asks for a title and a
// goal, and until this slice that was the last time either could be said. A
// chapter a generator run created is called by its slug, and a chapter created
// without a goal had no way to get one — the overview listed a heading nobody
// could correct. So the chapter overview gets the campaign header's two
// actions per chapter: the properties dialog for title and status, the edit
// dialog for the chapter text the goal line is read from.
//
// They stay two actions because they are two surfaces, not because of the
// wire: the title and the status are properties of the chapter, the goal is
// its text, and both travel through the one entry write. Each dialog runs its
// own editing session (lib/use-entry-edit.ts), so each has one guarded write
// and its own conflict answer.

/** Campaign-relative address of a chapter's entry — the chapter id itself. */
export function chapterMetaPath(chapter: string): string {
  return chapter;
}

/**
 * The text an edit save writes.
 *
 * The dialog edits the WHOLE chapter text as markdown — the same field the
 * reading view's editor writes, so nothing can disagree about what a chapter's
 * text is. Text that is blank after trimming is stored as the empty string
 * rather than as whitespace: the overview's goal line and the reading view both
 * treat "" as "no text", and three newlines would render as an empty section
 * instead.
 */
export function chapterBodyToWrite(body: string): string {
  const trimmed = body.trim();
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** Nothing typed and nothing stored — there is no write to make. */
export function chapterBodyChanged(next: string, stored: string): boolean {
  return chapterBodyToWrite(next) !== chapterBodyToWrite(stored);
}
