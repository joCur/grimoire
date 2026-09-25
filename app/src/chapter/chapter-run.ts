// The chapter a generator run creates, the pure half: the id a new chapter
// gets BEFORE anything exists — the next free numeric prefix from the tree
// plus the slug of the title —, whether an id the DM typed instead is usable,
// and when the suggestion still follows the title. Pure, so every rule is
// unit-testable.

import { toSlug } from "@grimoire/shared/slug";

import type { Translate } from "@/i18n";

/**
 * Next free chapter prefix: max numeric prefix of the existing chapter ids
 * plus one, zero-padded to the widest existing prefix (at least two
 * digits). Chapters without a numeric prefix are ignored; no chapters at
 * all -> "01".
 */
export function nextChapterPrefix(chapterIds: readonly string[]): string {
  let max = 0;
  let width = 2;
  for (const id of chapterIds) {
    const match = /^(\d+)/.exec(id);
    if (match === null) continue;
    const digits = match[1] as string;
    max = Math.max(max, Number(digits));
    width = Math.max(width, digits.length);
  }
  return String(max + 1).padStart(width, "0");
}

/**
 * The id a new chapter would get: `<next prefix>-<slug of the title>`.
 * Undefined while the title yields no slug — then there is nothing honest to
 * show yet.
 */
export function newChapterId(title: string, chapterIds: readonly string[]): string | undefined {
  const slug = toSlug(title);
  if (slug === "") return undefined;
  return `${nextChapterPrefix(chapterIds)}-${slug}`;
}

/**
 * Is this string usable as a chapter id? Returns the error text for the field
 * in the UI language, or undefined when the id is fine.
 *
 * A chapter id is a kebab slug (README: `01-salzhafen`), so uppercase,
 * umlauts and underscores are rejected — deliberately as an error, never as a
 * silent rewrite: a typed id is the DM's decision, and an id is a stable
 * reference that must not change under them. A number prefix is optional
 * (`schmugglerbucht` is as valid as `03-schmugglerbucht`). The server stays
 * the last instance; checking here only saves the round trip.
 *
 * Order of the checks is by specificity: the most precise complaint wins,
 * the charset rule is the catch-all.
 */
export function chapterIdError(id: string, t: Translate): string | undefined {
  if (id === "") return t("generate.input.chapterId.missing");
  if (id.includes("/") || id.includes("\\")) return t("generate.input.chapterId.slash");
  if (id.includes("..")) return t("generate.input.chapterId.dots");
  if (id.startsWith(".")) return t("generate.input.chapterId.leadingDot");
  if (/\s/.test(id)) return t("generate.input.chapterId.space");
  if (!/^[a-z0-9-]+$/.test(id)) return t("generate.input.chapterId.charset");
  return undefined;
}

/**
 * What the chapter-id field shows: the typed value once the DM has touched
 * the field, the derived suggestion until then. `manual === undefined` IS the
 * untouched state — and because the view maps an emptied field back to
 * undefined, clearing the field lets the suggestion follow the title again.
 */
export function chapterIdValue(suggestion: string | undefined, manual: string | undefined): string {
  return manual ?? suggestion ?? "";
}
