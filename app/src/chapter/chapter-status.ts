// Chapter status: the labels/colors the overview's control and the chapter's
// dialog share, and the write behind the control (the rev conflict is the
// shared protocol in lib/write-with-rev.ts).
//
// Same shape as scene/scene-status.ts, and deliberately so — the labels come
// from the catalog and the translator is PASSED IN (a pure helper must not
// decide which language the UI is in), the colors stay here because they are
// design tokens rather than copy.
//
// Every value is one PATCH of the chapter's `status`. `active` is one of
// them: at most one chapter per campaign is active, so the server puts the
// chapter that held it back to `planned` in the same transaction — the rule
// holds on every write path, and the app only has to refetch both chapters.
//
// `chapters.status` is a CHECK constraint of its column, so the database
// cannot hold anything else (ADR #25) and the stored value is one of the
// three. An ABSENT one is the only other case: every path that creates a
// chapter writes `planned`, and no status on a chapter means "not started",
// which is what `planned` says.

import { CHAPTER_STATUSES } from "@grimoire/shared/chapter";
import type { Chapter, ChapterPatch, ChapterStatus } from "@grimoire/shared/types";

import type { MessageKey, Translate } from "@/i18n";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

import { fetchChapter, patchChapter } from "./chapter-api";

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

/** The stored value normalized for display: an absent one reads as `planned`. */
export function chapterStatusValue(status: ChapterStatus | undefined): ChapterStatus {
  return status ?? CHAPTER_STATUS_DEFAULT;
}

/** True for one of the three values the API accepts. */
export function isChapterStatus(status: string): status is ChapterStatus {
  return (CHAPTER_STATUSES as readonly string[]).includes(status);
}

/** Label + colors for a status value. */
export function chapterStatusMeta(
  status: ChapterStatus,
  t: Translate,
): { label: string; dot: string; text: string } {
  const { key, dot, text } = CHAPTER_STATUS_META[status];
  return { label: t(key), dot, text };
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

/** Request of the status write — the rev comes from the chapter as it was read. */
export function chapterStatusPatchBody(rev: number, status: ChapterStatus): ChapterPatch {
  return { rev, status };
}

/**
 * Write the chapter's `status`. The 409 handling — nothing written, re-read
 * once so the next attempt carries the fresh rev — is the shared protocol of
 * lib/write-with-rev.ts. Every other failure throws.
 */
export function writeChapterStatus(
  campaign: string,
  id: string,
  rev: number,
  status: ChapterStatus,
): Promise<RevWriteResult<Chapter>> {
  return writeWithRev(
    () => patchChapter(campaign, id, chapterStatusPatchBody(rev, status)),
    () => fetchChapter(campaign, id),
  );
}
