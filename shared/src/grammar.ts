// The GRAMMAR of the two Grimoire markdown extensions (README: callouts and
// `## If:` sections) — one module, so nothing that reads them can disagree
// about what they are.
//
// Every party that reads this vocabulary imports it from here:
//
//   app/src/markdown/remark-grimoire.ts   the renderer's mdast pass
//   app/src/markdown/Callout.tsx          the six callout names
//   ./blocks.ts                           the block model's line scan, which
//                                         the Block-Composer edits with and
//                                         the server patches a proposal with
//
// A reader that models the text differently from the renderer shows the DM a
// structure their body does not have — so the predicates live here exactly
// once.
//
// No react, no mdast: plain string predicates, callable from every side.

import { CALLOUT_KINDS, type CalloutKind } from "./callouts";

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
 * line scan asks (blocks.ts), already-plain text when the renderer asks
 * (mdastToString). Both spellings answer the same here — that is the whole
 * point of the shared predicate.
 */
export function ifSectionCondition(depth: number, text: string): string | null {
  if (depth !== IF_SECTION_DEPTH) return null;
  const match = IF_PREFIX.exec(text);
  if (match === null) return null;
  return text.slice(match[0].length).trim();
}

/**
 * Does a heading of this depth END the running `## If:` section? THE boundary
 * of the format: the renderer groups its `<details>` up to it, the line scan
 * reads a section's children up to it, and it is the reason a new heading
 * inside a section starts at level 3 (a `##` would take the blocks below it
 * out of the branch).
 */
export function endsIfSection(depth: number): boolean {
  return depth <= IF_SECTION_DEPTH;
}
