// Pure helpers of the review view: hashtag handling, the grouping of
// player-character notes and the NPC-slug derivation for the stub dialog. No
// react, no query imports.
//
// Log rows, inbox rows and the chapter's open threads arrive as ROWS from the
// server and are named by their id, so nothing here parses a list out of text.
//
// Everything degrades (README): unparsable input yields empty results or
// passes through unchanged, never an error.

import { toSlug } from "@grimoire/shared/slug";

import { isEntityId } from "@/lib/entity";

/**
 * The log/inbox hashtags the review harvests (README). `#date` is deliberately
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
 * harvest (no thread, no NPC stub), it is a reminder for the table. Where both
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
 * Tags that belong to the log/inbox CONVENTION (README) and can therefore
 * never be a character name: `#pc` itself, the four harvest tags and `#date`.
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

// --- npc slug ----------------------------------------------------------------

/** An npc id is an entity id — one slug rule for the whole app (lib/entity). */
export function isNpcSlug(id: string): boolean {
  return isEntityId(id);
}

const QUOTED = /["“„»'‚]([^"“”„«»'‚‘]{2,40})["”“«'‘]/u;
const CAPITALIZED = /\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,2}/gu;

/**
 * The name a log row probably introduces: a quoted name wins
 * (`Improvisiert: Fischerin "Old Metta" am Steg` → `Old Metta`), otherwise
 * the first run of capitalized words that is not a label ending in `:`.
 * Undefined when nothing looks like a name — the dialog then starts empty.
 */
export function npcNameFromText(text: string): string | undefined {
  const quoted = QUOTED.exec(text);
  const inQuotes = quoted?.[1]?.trim();
  if (inQuotes !== undefined && inQuotes !== "") return inQuotes;

  for (const match of text.matchAll(CAPITALIZED)) {
    const name = match[0].trim();
    const after = text.charAt((match.index ?? 0) + match[0].length);
    if (after === ":") continue; // "Improvisiert:", "Neuer NPC:" — a label
    if (name !== "") return name;
  }
  return undefined;
}

/**
 * Kebab-case slug of a display name (German transliteration, diacritics
 * folded); an empty string when nothing usable is left. The rule lives in
 * `@grimoire/shared/slug` — the create dialogs derive ids the same way and the
 * SERVER has to agree with them — and is re-exported here for the callers that
 * already read it from this module.
 */
export { toSlug };

/** Slug proposal for the NPC-stub dialog (editable there); "" when the text
 *  carries no recognizable name. */
export function deriveNpcSlug(text: string): string {
  const name = npcNameFromText(text);
  return name === undefined ? "" : toSlug(name);
}
