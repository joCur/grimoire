// Chapter status: the labels/colors the overview's control and the chapter
// properties form share, and the two writes behind them.
//
// Same shape as lib/scene-status.ts, and deliberately so — the labels come
// from the catalog and the translator is PASSED IN (the lib layer must not
// decide which language the UI is in), the colors stay here because they are
// design tokens rather than copy.
//
// What is DIFFERENT from a scene is the write. Two of the three values are an
// ordinary properties patch on the chapter entry; `active` is not, because it
// is one decision about TWO chapters — this one becomes active and the one
// that held the flag goes back to `planned`. That swap is the dedicated
// endpoint (`POST /chapters/:id/active`), which needs no rev: it also changes
// a chapter the caller never read. The server enforces the same swap for a
// properties patch that sets `active`, so the rule does not depend on this
// module choosing the right door — but choosing it is still what keeps the
// app's cache honest about both chapters.
//
// Degrade rule (README): an unknown stored value is shown VERBATIM. An ABSENT
// one is not the same case: every path that creates a chapter writes
// `planned`, so nothing only survives on an older chapter — and no status on a
// chapter means "not started", which is what `planned` says.

import { CHAPTER_STATUSES, type ChapterStatus } from "@grimoire/shared/types";

import { fetchEntry, patchEntry, setChapterActive } from "@/api";
import type { MessageKey, Translate } from "@/i18n";
import { chapterMetaPath } from "@/lib/chapter-meta";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

/** Where a chapter without a stored status is read — see the header. */
export const CHAPTER_STATUS_DEFAULT: ChapterStatus = "planned";

/**
 * Catalog key + dot/text colors per status. `active` borrows the green of a
 * scene's ready status on purpose: in both cases it is the value that says
 * "this is the one the evening runs on". `done` is the quiet end of the scale,
 * like a scene that has been played.
 */
const CHAPTER_STATUS_META: Record<ChapterStatus, { key: MessageKey; dot: string; text: string }> = {
  planned: {
    key: "properties.chapter.status.planned",
    dot: "bg-muted-foreground",
    text: "text-dim",
  },
  active: { key: "properties.chapter.status.active", dot: "bg-success", text: "text-success-text" },
  done: { key: "properties.chapter.status.done", dot: "bg-faint", text: "text-muted-foreground" },
};

/** The stored value normalized for display: absent/blank reads as `planned`. */
export function chapterStatusValue(status: string | undefined): string {
  return status === undefined || status.trim() === "" ? CHAPTER_STATUS_DEFAULT : status;
}

function knownStatus(status: string): ChapterStatus | undefined {
  return (CHAPTER_STATUSES as readonly string[]).includes(status)
    ? (status as ChapterStatus)
    : undefined;
}

/** True for one of the three values the API accepts. */
export function isChapterStatus(status: string): status is ChapterStatus {
  return knownStatus(status) !== undefined;
}

/** Label + colors for a status value; an unknown value keeps its raw label. */
export function chapterStatusMeta(
  status: string,
  t: Translate,
): { label: string; dot: string; text: string } {
  const known = knownStatus(status);
  if (known !== undefined) {
    const { key, dot, text } = CHAPTER_STATUS_META[known];
    return { label: t(key), dot, text };
  }
  return { label: status, dot: "bg-muted-foreground", text: "text-dim" };
}

/**
 * The three selectable options — `CHAPTER_STATUSES` from @grimoire/shared is
 * the single source, and already in lifecycle order (planned → active →
 * done). A FUNCTION, not a constant: the labels depend on the UI language.
 */
export function chapterStatusOptions(
  t: Translate,
): ReadonlyArray<{ value: ChapterStatus; label: string }> {
  return CHAPTER_STATUSES.map((value) => ({ value, label: t(CHAPTER_STATUS_META[value].key) }));
}

/**
 * True when writing `status` means asking the server to SWAP the active
 * chapter rather than to patch this one — the one branch the overview's
 * control and the properties dialog both have to take.
 */
export function chapterStatusNeedsSwap(status: string): boolean {
  return status === "active";
}

/**
 * Write one status value.
 *
 * `active` goes to the swap endpoint (no rev — there is nothing to overwrite,
 * and it deliberately changes a second chapter); the other two are the
 * ordinary guarded patch with the 409 re-read of ADR #4. Only the patch needs
 * a rev, which is why `chapterStatusWritable` gates the caller rather than
 * this function refusing halfway.
 */
export async function writeChapterStatus(
  campaign: string,
  chapter: string,
  status: string,
  rev: number | undefined,
): Promise<RevWriteResult> {
  if (chapterStatusNeedsSwap(status)) {
    return { ok: true, entry: await setChapterActive(campaign, chapter) };
  }
  // Unreachable behind `chapterStatusWritable`; an assertion, not a path.
  if (rev === undefined) throw new Error("no version to write against");
  const path = chapterMetaPath(chapter);
  return writeWithRev(
    () => patchEntry(campaign, path, { rev, properties: { status } }),
    () => fetchEntry(campaign, path),
  );
}

/**
 * Can this value be written with what we have? A patch needs the rev of the
 * chapter entry, which an overview row only fetches once the control opens;
 * the swap needs no rev at all.
 *
 * `current` is what the row SHOWS: a chapter that already holds the flag is
 * never set active again. The endpoint would happily re-assert it, and that is
 * the damage — the swap moves a SECOND chapter, so `active` on the chapter
 * whose control still shows the active state (the previously active one, until the
 * invalidation lands) pulls the flag back off the chapter the DM just picked.
 * The domain rule, next to the control's own no-op filter
 * (`statusSelectionWrites`): this one holds for every caller of the write.
 */
export function chapterStatusWritable(
  status: string,
  rev: number | undefined,
  current?: string | undefined,
): boolean {
  if (chapterStatusNeedsSwap(status)) return current !== "active";
  return rev !== undefined;
}
