// Pure helpers of the review view: hashtag handling and the grouping of
// player-character notes. No react, no query imports.
//
// Log rows, ideas and threads arrive as ROWS from the server and are named by
// their id, so nothing here parses a list out of text.
//
// Everything degrades (README): unparsable input yields empty results or
// passes through unchanged, never an error.


/**
 * The hashtags of the log and the ideas the review harvests (README). `#date` is deliberately
 * NOT one of them — in-game dates are no harvest.
 */
export const REVIEW_TAGS = ["thread", "npc", "loot", "decision"] as const;

/** One of the four harvest tags? */
export function isReviewTag(tag: string): boolean {
  const tags: readonly string[] = REVIEW_TAGS;
  return tags.includes(tag);
}

/** Actions the review offers for a tag (prototype: thread/decision → thread). */
export function tagAllowsThread(tag: string): boolean {
  return tag === "thread" || tag === "decision";
}

export function tagAllowsNpc(tag: string): boolean {
  return tag === "npc";
}

/**
 * The player-character tag (README): `#pc` marks a note ABOUT a player
 * character. It is deliberately not part of REVIEW_TAGS — a `#pc` row is no
 * harvest (no thread, no npc), it is a reminder for the table. Where both
 * appear (`#pc #thread`), `#pc` wins.
 */
export const PC_TAG = "pc";

// `#tag` — letters/digits (unicode: `#öl` works), then also `_`/`-`.
const HASHTAG = /#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/** All hashtags of a row's text, lowercased, in order (without the `#`). */
export function extractHashtags(text: string): string[] {
  return [...text.matchAll(HASHTAG)].map((m) => (m[1] ?? "").toLowerCase());
}

/** The first hashtag from REVIEW_TAGS — the row filter of the review. */
export function firstReviewTag(text: string): string | undefined {
  return extractHashtags(text).find(isReviewTag);
}

/**
 * Display text of a row: hashtags removed, whitespace collapsed. A row that is
 * nothing but hashtags keeps its original text — an empty card would be worse.
 */
export function stripHashtags(text: string): string {
  const stripped = text
    .replace(/\s*#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped === "" ? text.trim() : stripped;
}

// --- player-character notes ---------------------------------------------------

/** Does this row carry `#pc`? (`#pcs`/`#npc` are other tags — no match.) */
export function hasPcTag(tags: readonly string[]): boolean {
  return tags.includes(PC_TAG);
}

/**
 * Tags that belong to the CONVENTION of log and ideas (README) and can
 * therefore never be a character name: `#pc` itself, the four harvest tags and
 * `#date`.
 * A row tagged `#pc #thread` is a reminder that also mentions a thread — not a
 * note about a character named after that tag.
 */
function isConventionTag(tag: string): boolean {
  return tag === PC_TAG || tag === "date" || isReviewTag(tag);
}

/**
 * The character a `#pc` row names: the first hashtag that is not a
 * convention tag (`#pc #kaela` → `kaela`, `#kaela #pc` → `kaela`, already
 * lowercased by extractHashtags). Undefined when the row carries convention
 * tags only — the review groups those under its general heading.
 */
export function pcGroupTag(tags: readonly string[]): string | undefined {
  return tags.find((tag) => !isConventionTag(tag));
}

/** One group of the player-character section. */
export interface PcGroup<T> {
  /** The second tag, or undefined for the „Allgemein" group. */
  tag: string | undefined;
  entries: T[];
}

/**
 * Group entries by their character tag, in first-appearance order; the
 * untagged („Allgemein") group always comes last, however early it appeared.
 * Pure and entry-shape agnostic — the caller says where the tag sits.
 */
export function groupByPcTag<T>(
  entries: readonly T[],
  tagOf: (entry: T) => string | undefined,
): PcGroup<T>[] {
  const named = new Map<string, T[]>();
  const general: T[] = [];
  for (const entry of entries) {
    const tag = tagOf(entry);
    if (tag === undefined || tag === "") {
      general.push(entry);
      continue;
    }
    const bucket = named.get(tag);
    if (bucket === undefined) named.set(tag, [entry]);
    else bucket.push(entry);
  }
  const groups: PcGroup<T>[] = [...named].map(([tag, items]) => ({ tag, entries: items }));
  if (general.length > 0) groups.push({ tag: undefined, entries: general });
  return groups;
}
