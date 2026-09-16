// The GRAMMAR of the two Grimoire markdown extensions (README: callouts and
// `## If:` sections) — one module, so nothing that reads them can disagree
// about what they are.
//
// Three parties read this vocabulary:
//
//   app/src/markdown/remark-grimoire.ts   the renderer's mdast pass
//   app/src/markdown/Callout.tsx          the six callout names
//   app/src/lib/blocks.ts                 the Block-Composer's line scan
//
// Before this module each of them carried its own copy, and the copies had
// already drifted: the If-prefix was `[ \t]*` on one side and `\s*` on the
// other, and `## *If:* x` was a collapsible section in the reading view but a
// plain heading card in the composer. A composer that models the text
// differently from the renderer shows the DM a structure their body does not
// have — so the predicates live here exactly once.
//
// No react, no mdast: plain string predicates, callable from both sides.

import { CALLOUT_KINDS, type CalloutKind } from "@grimoire/shared/types";

import type { MessageKey } from "@/i18n";

// --- callouts ----------------------------------------------------------------

/**
 * The `[!kind]` marker at the start of a callout's first line; `[1]` is the
 * kind as written. Case-insensitive (`[!NOTE]` is a note) and it eats the
 * spaces after the marker, so the text starts where the DM's words start.
 */
export const CALLOUT_MARKER = /^\[!([a-z0-9-]+)\][ \t]*/i;

/**
 * One of the six kinds the renderer knows? An unknown kind is never an error:
 * the renderer leaves it as a plain blockquote and the composer keeps it as a
 * raw block (README: the format degrades).
 */
export function isCalloutKind(kind: string): kind is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(kind);
}

/**
 * The CATALOG KEYS of the six callout names (issue #69). The words themselves
 * live in app/src/i18n — but which key belongs to which kind is part of the
 * format's vocabulary and therefore belongs here: the reading view's label row
 * (Callout.tsx) and the composer's cards and type picker (lib/blocks.ts) must
 * name a block identically, in every language.
 *
 * Only a key lookup, no translator: this module stays free of React and of the
 * catalogs, so both sides can keep asking it what a block IS.
 */
export const CALLOUT_LABEL_KEYS: Record<CalloutKind, MessageKey> = {
  readaloud: "markdown.callout.readaloud",
  check: "markdown.callout.check",
  secret: "markdown.callout.secret",
  outcome: "markdown.callout.outcome",
  loot: "markdown.callout.loot",
  note: "markdown.callout.note",
};

// --- `## If:` sections -------------------------------------------------------

/** An If-section is an H2 — deeper or shallower is an ordinary heading. */
const IF_SECTION_DEPTH = 2;

/**
 * `If:` at the start of a heading, together with the inline markup a DM may
 * have wrapped it in: the renderer matches on `mdastToString(heading)`, which
 * drops emphasis, so `## *If:* x` and `## **If:** x` ARE sections in the
 * reading view — and the composer has to read them the same way.
 *
 * Only the wrappers AROUND the prefix are stripped, never markup inside the
 * condition: `## If: sie *lügen*` keeps its emphasis.
 */
const IF_PREFIX = /^[*_`]*if:[*_`]*[ \t]*/i;

/**
 * The condition of an `## If: …` heading, or null for any other heading.
 *
 * `text` is the heading's text without its `#` markers: raw markdown when the
 * composer's line scan asks (blocks.ts), already-plain text when the renderer
 * asks (mdastToString). Both spellings answer the same here — that is the
 * whole point of the shared predicate.
 */
export function ifSectionCondition(depth: number, text: string): string | null {
  if (depth !== IF_SECTION_DEPTH) return null;
  const match = IF_PREFIX.exec(text);
  if (match === null) return null;
  return text.slice(match[0].length).trim();
}

/**
 * Does a heading of this depth END the running `## If:` section? THE boundary
 * of the format: the renderer groups its `<details>` up to it, the composer
 * scans a section's children up to it, and it is the reason a new heading
 * inside a section starts at level 3 (a `##` would take the blocks below it
 * out of the branch).
 */
export function endsIfSection(depth: number): boolean {
  return depth <= IF_SECTION_DEPTH;
}
