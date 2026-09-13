// The POST-RUN naming check (issue #53 AK3).
//
// A naming convention says „write <from> as <to>". The prompt asks the model
// to apply it, and this module checks afterwards whether the finished draft
// still carries the OLD spelling — because a prompt is a request, not a
// guarantee, and finding out during the session is the expensive way.
//
// It is DELIBERATELY A PLAIN TEXT SEARCH. Case-insensitive, at word
// boundaries, no stemming, no inflection, no "did they maybe mean this"
// (the ticket: „Einfache Textsuche, kein Raten"). Everything cleverer would
// produce findings the DM cannot check against the rule they wrote, and the
// findings are HINTS in the review — nothing here can fail a run or block an
// apply.
//
// What "word boundary" means here cannot be `\b`: `\b` is defined over
// `[A-Za-z0-9_]`, so it fires INSIDE „Straße" and around „Salzhafens" in ways
// a German reader would not expect, and a `from` like „Salt Harbour" (with a
// space) or „St. Mere" (with a dot) has no `\b` at the end at all. So the
// boundary is spelled out over LETTERS AND DIGITS in the Unicode sense: a hit
// counts when the character before and after it is not one — „Salzhafen"
// inside „Salzhafens" is NOT reported (it is the same word inflected, and the
// DM would have to dismiss that hint every single run), while „Salzhafen,"
// and „(Salzhafen)" are.
//
// The check looks at the BODY and at the properties that hold PROSE the DM
// reads out or shows (title, role, voice, appearance, trigger, name, …). It
// deliberately does NOT look at ids, references or tags: those are addresses,
// and a naming convention is about wording. Renaming an entity is issue
// #29/#30's endpoint, not a generator hint.

import { parseMarkdown, type NamingHint } from "@grimoire/shared";

/**
 * Properties whose value is PROSE and therefore in scope. Everything not
 * listed is an address, a status token or a list — see the header.
 *
 * `name` and `title` are both here because a scene has a title and an npc a
 * name, and a run produces either kind of draft. One consequence worth
 * knowing: the shared parser falls back to the ID when a display name is
 * missing (shared/src/parse.ts), so a title-less draft is checked against
 * its id. That is not a bug to guard against — the id is then literally what
 * the pool shows the DM.
 */
const CHECKED_PROPERTIES = [
  "title",
  "name",
  "role",
  "voice",
  "appearance",
  "trigger",
  "statblock",
] as const;

/** How much of a line travels as the finding's `excerpt`. */
const EXCERPT_LIMIT = 160;

/** One naming convention, as the check needs it. */
export interface NamingRule {
  from: string;
  to: string;
}

/** Unicode letter-or-digit — the boundary class (see the header). */
const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Every word-boundary, case-insensitive occurrence of `needle` in `haystack`,
 * as start offsets. An empty or blank needle matches nothing — a rule the DM
 * has not finished typing must not flag every draft.
 *
 * `toLowerCase()` on both sides rather than a case-insensitive regex, because
 * the needle is USER TEXT and would have to be escaped for a regex anyway;
 * lower-casing both is the same comparison without the escaping question.
 * (German „ß"/„SS" is the one pair this does not fold — an acceptable gap for
 * a hint, and folding it would need locale-aware case mapping.)
 */
export function findWordHits(haystack: string, needle: string): number[] {
  const trimmed = needle.trim();
  if (trimmed === "") return [];
  const hay = haystack.toLowerCase();
  const pin = trimmed.toLowerCase();
  const hits: number[] = [];
  let at = hay.indexOf(pin);
  while (at !== -1) {
    const before = at === 0 ? undefined : hay[at - 1];
    const after = hay[at + pin.length];
    // A needle that STARTS or ENDS with a non-word character carries its own
    // boundary there (a rule „(Salzhafen)" means the parentheses), so the
    // neighbour is only checked on the sides where the needle has a word
    // character to be glued to.
    const startOk = !isWordChar(pin[0]) || !isWordChar(before);
    const endOk = !isWordChar(pin[pin.length - 1]) || !isWordChar(after);
    if (startOk && endOk) hits.push(at);
    at = hay.indexOf(pin, at + 1);
  }
  return hits;
}

function excerpt(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= EXCERPT_LIMIT ? trimmed : `${trimmed.slice(0, EXCERPT_LIMIT)}…`;
}

/**
 * Check ONE draft against the campaign's naming conventions.
 *
 * `markdown` is the complete draft file (properties block included) — the
 * same string the review shows and apply writes, so the check can never
 * disagree with what the DM is looking at. It is parsed with the shared
 * parser; a body that does not parse degrades to "everything is body", which
 * still gets searched.
 *
 * At most ONE finding per rule per line: a convention broken three times in
 * one sentence is one thing to fix, and three identical rows in the review
 * would only bury the other hints.
 */
export function checkDraftNaming(
  path: string,
  markdown: string,
  rules: readonly NamingRule[],
): NamingHint[] {
  if (rules.length === 0) return [];
  // The path/rev arguments are the parser's document identity and irrelevant
  // here: the check reads `properties` and `body`, nothing that depends on
  // which KIND the document is.
  const parsed = parseMarkdown(markdown, path, 0);
  const hints: NamingHint[] = [];

  for (const rule of rules) {
    // Properties first: a wrong title is the thing the DM sees in the pool.
    for (const key of CHECKED_PROPERTIES) {
      const value = parsed.properties[key];
      if (typeof value !== "string") continue;
      if (findWordHits(value, rule.from).length === 0) continue;
      hints.push({ from: rule.from, to: rule.to, path, field: key, excerpt: excerpt(value) });
    }
    const lines = parsed.body.split("\n");
    for (const [index, line] of lines.entries()) {
      if (findWordHits(line, rule.from).length === 0) continue;
      hints.push({
        from: rule.from,
        to: rule.to,
        path,
        field: "body",
        line: index + 1,
        excerpt: excerpt(line),
      });
    }
  }
  return hints;
}

/**
 * Check a whole run's drafts. Order is draft order, then rule order, then
 * position inside the draft — stable, so the review list does not reshuffle
 * between two polls of the same job.
 */
export function checkDraftsNaming(
  drafts: ReadonlyArray<{ path: string; markdown: string }>,
  rules: readonly NamingRule[],
): NamingHint[] {
  return drafts.flatMap((draft) => checkDraftNaming(draft.path, draft.markdown, rules));
}
