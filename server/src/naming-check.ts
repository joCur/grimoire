// The POST-RUN naming check.
//
// A naming convention says "write <from> as <to>". The prompt asks the model
// to apply it, and this module checks afterwards whether the finished draft
// still carries the OLD spelling — because a prompt is a request, not a
// guarantee, and finding out during the session is the expensive way.
//
// It is DELIBERATELY A PLAIN TEXT SEARCH. Case-insensitive, at word
// boundaries, no stemming, no inflection, no "did they maybe mean this"
// a plain text search without guessing. Everything cleverer would produce
// findings the DM cannot check against the rule they wrote, and the findings
// are HINTS in the review — nothing here can fail a run or block an apply.
//
// What "word boundary" means here cannot be `\b`: `\b` is defined over
// `[A-Za-z0-9_]`, so it fires INSIDE "Straße" and around "Salzhafens" in ways
// a German reader would not expect, and a `from` like "Salt Harbour" (with a
// space) or "St. Mere" (with a dot) has no `\b` at the end at all. So the
// boundary is spelled out over LETTERS AND DIGITS in the Unicode sense: a hit
// counts when the character before and after it is not one — "Salzhafen"
// inside "Salzhafens" is NOT reported (it is the same word inflected, and the
// DM would have to dismiss that hint every single run), while "Salzhafen,"
// and "(Salzhafen)" are.
//
// TWO REFINEMENTS the plain search needs to stay useful:
// a hit that sits INSIDE an occurrence of `to` is not reported (a rule
// "Dragon" → "Red Dragon" must not flag the corrected "Red Dragon"), and a
// rule whose two sides differ only in CASE is searched case-sensitively, so
// "salzhafen" → "Salzhafen" flags the lower-case spelling and not its own
// target. Both are `findRuleHits`.
//
// `from`/`to` arrive here ALREADY ref-expanded (store/knowledge.ts namingRules):
// the DM may write a rule as "[[fenn]]", and the drafts contain the name.
//
// The check looks at the BODY and at the properties that hold PROSE the DM
// reads out or shows (title, role, voice, appearance, trigger, name, …). It
// deliberately does NOT look at ids, references or tags: those are addresses,
// and a naming convention is about wording. Renaming an entity is the rename
// endpoint's job, not a generator hint.

import type { NamingHint } from "@grimoire/shared";

/**
 * Properties whose value is PROSE and therefore in scope. Everything not
 * listed is an address, a status token or a list — see the header.
 *
 * `name` and `title` are both here because a scene has a title and an npc a
 * name, and a run produces either kind of draft. One consequence worth
 * knowing: a draft whose display name is missing carries its id there
 * instead (the validators fill it in), so such a draft is checked against
 * its id. That is not a bug to guard against — the id is then literally what
 * the chapter overview shows the DM.
 */
const CHECKED_PROPERTIES = [
  "title",
  "name",
  "role",
  "voice",
  "appearance",
  "motivation",
  "atmosphere",
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
 * ("ß"/"SS" is the one pair this does not fold — an acceptable gap for
 * a hint, and folding it would need locale-aware case mapping.)
 */
export function findWordHits(
  haystack: string,
  needle: string,
  options: { caseSensitive?: boolean } = {},
): number[] {
  const trimmed = needle.trim();
  if (trimmed === "") return [];
  const fold = (s: string): string => (options.caseSensitive === true ? s : s.toLowerCase());
  const hay = fold(haystack);
  const pin = fold(trimmed);
  const hits: number[] = [];
  let at = hay.indexOf(pin);
  while (at !== -1) {
    const before = at === 0 ? undefined : hay[at - 1];
    const after = hay[at + pin.length];
    // A needle that STARTS or ENDS with a non-word character carries its own
    // boundary there (a rule "(Salzhafen)" means the parentheses), so the
    // neighbour is only checked on the sides where the needle has a word
    // character to be glued to.
    const startOk = !isWordChar(pin[0]) || !isWordChar(before);
    const endOk = !isWordChar(pin[pin.length - 1]) || !isWordChar(after);
    if (startOk && endOk) hits.push(at);
    at = hay.indexOf(pin, at + 1);
  }
  return hits;
}

/**
 * Is this rule only about CASING — "salzhafen" → "Salzhafen"?
 *
 * It matters because the check is case-insensitive everywhere else: a
 * case-insensitive search for "salzhafen" finds the CORRECT "Salzhafen" too,
 * and a rule that flags its own target is a rule the DM can only turn off.
 * So a casing-only rule is searched case-SENSITIVELY — then "salzhafen" is a
 * finding and "Salzhafen" is not, which is exactly what the rule says.
 */
export function isCasingOnlyRule(rule: NamingRule): boolean {
  const from = rule.from.trim();
  const to = rule.to.trim();
  if (from === "" || to === "" || from === to) return false;
  return from.toLowerCase() === to.toLowerCase();
}

/**
 * Every occurrence of `needle` in `haystack` as `[start, end)` spans. NO word
 * boundary here — this is used to find where the NEW spelling stands, and a
 * hit sitting inside "Red Dragons" is still sitting inside the new spelling.
 */
function spansOf(haystack: string, needle: string, caseSensitive: boolean): Array<[number, number]> {
  if (needle === "") return [];
  const hay = caseSensitive ? haystack : haystack.toLowerCase();
  const pin = caseSensitive ? needle : needle.toLowerCase();
  const spans: Array<[number, number]> = [];
  let at = hay.indexOf(pin);
  while (at !== -1) {
    spans.push([at, at + pin.length]);
    at = hay.indexOf(pin, at + 1);
  }
  return spans;
}

/**
 * The hits of ONE RULE in one piece of text — `findWordHits` plus the two
 * things that separate "the old spelling is still here" from a false alarm:
 *
 *   1. A hit that lies INSIDE an occurrence of `to` is not a finding. "Dragon"
 *      → "Red Dragon" is the common shape: the new spelling CONTAINS the old
 *      one, so a correctly rewritten "Red Dragon" would otherwise be reported
 *      on every run — the one hint that fires precisely when the model did as
 *      it was told.
 *   2. A casing-only rule is searched case-sensitively (see
 *      `isCasingOnlyRule`), so it flags the wrong casing and nothing else.
 */
export function findRuleHits(text: string, rule: NamingRule): number[] {
  const from = rule.from.trim();
  const to = rule.to.trim();
  if (from === "") return [];
  const caseSensitive = isCasingOnlyRule(rule);
  const hits = findWordHits(text, from, { caseSensitive });
  if (hits.length === 0 || to === "") return hits;
  const covered = spansOf(text, to, caseSensitive);
  if (covered.length === 0) return hits;
  return hits.filter(
    (at) => !covered.some(([start, end]) => at >= start && at + from.length <= end),
  );
}

function excerpt(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= EXCERPT_LIMIT ? trimmed : `${trimmed.slice(0, EXCERPT_LIMIT)}…`;
}

/**
 * One text as the check reads it: a scene or npc draft by its address, its
 * properties and its body, or a location by its id, the fields to check and
 * its body.
 */
export type CheckedDraft =
  | { path: string; properties: Record<string, unknown>; body: string }
  | { location: string; fields: Record<string, unknown>; body: string };

/**
 * Check ONE draft against the campaign's naming conventions.
 *
 * The draft arrives as the two halves the review shows and apply writes —
 * its properties and its body — so the check can never disagree with what
 * the DM is looking at.
 *
 * At most ONE finding per rule per line: a convention broken three times in
 * one sentence is one thing to fix, and three identical rows in the review
 * would only bury the other hints.
 */
export function checkDraftNaming(draft: CheckedDraft, rules: readonly NamingRule[]): NamingHint[] {
  if (rules.length === 0) return [];
  const where = "location" in draft ? { location: draft.location } : { path: draft.path };
  const fields = "location" in draft ? draft.fields : draft.properties;
  const hints: NamingHint[] = [];

  for (const rule of rules) {
    // Fields first: a wrong title is the thing the DM sees in the chapter overview.
    for (const key of CHECKED_PROPERTIES) {
      const value = fields[key];
      if (typeof value !== "string") continue;
      if (findRuleHits(value, rule).length === 0) continue;
      hints.push({ from: rule.from, to: rule.to, ...where, field: key, excerpt: excerpt(value) });
    }
    const lines = draft.body.split("\n");
    for (const [index, line] of lines.entries()) {
      if (findRuleHits(line, rule).length === 0) continue;
      hints.push({
        from: rule.from,
        to: rule.to,
        ...where,
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
  drafts: readonly CheckedDraft[],
  rules: readonly NamingRule[],
): NamingHint[] {
  return drafts.flatMap((draft) => checkDraftNaming(draft, rules));
}
