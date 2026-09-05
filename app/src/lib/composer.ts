// State and rules of the Block-Composer UI (issue #43, phase 2) — the layer
// between the block model (lib/blocks.ts, phase 1) and the React components.
//
// Three jobs, all pure and therefore unit-testable without a DOM:
//
//   1. THE DRAFT. Edit mode has two surfaces — the block list („Blöcke", the
//      default) and the raw textarea („Roh", the fallback from issue #39) — and
//      exactly ONE state behind them: this module's ComposerDraft is a
//      discriminated union, so at any moment either the blocks or the text are
//      authoritative and there is nothing to diverge. Switching modes goes
//      through serializeBlocks / parseBlocks, which phase 1 guarantees to be
//      lossless (`serializeBlocks(parseBlocks(body)) === body`).
//   2. TREE EDITS. The composer shows two levels: the document and the children
//      of an `## If:` section. Every operation here addresses a block by id,
//      finds the list that OWNS it and routes the change through the phase-1
//      helpers — withBlockText/withIfCondition (which drop the block's `source`,
//      the dirty flag) and insertBlock/removeBlock/moveBlock (which keep the
//      whitespace scaffolding in place). Nothing in the composer builds a block
//      by hand, so no edit can be swallowed by a stale `source`.
//   3. VALIDATION. composerIssues names, per block, what a save would silently
//      break — the seam the frontmatter form already uses (issue #42): the
//      card says it, „Speichern" waits, and nothing the DM typed is rewritten.
//
// Deliberately NOT here: cross-section moves (a block cannot be dragged out of
// its If-section in this slice) and nested sections (blocks.ts does not model
// them — a second `## If:` ends the first).

import { CALLOUT_KINDS } from "@grimoire/shared/types";

import {
  blockMarkdown,
  calloutLabel,
  endsIfSectionText,
  insertBlock,
  makeCallout,
  makeHeading,
  makeIfSection,
  makeText,
  moveBlock,
  parseBlocks,
  removeBlock,
  serializeBlocks,
  withBlockText,
  withChildren,
  withIfCondition,
  type HeadingBlock,
  type IfSectionBlock,
  type SceneBlock,
} from "@/lib/blocks";
import { endsIfSection } from "@/markdown/grammar";

// --- the draft ---------------------------------------------------------------

/** „Blöcke" (the block list) or „Roh" (the markdown textarea). */
export type ComposerMode = "blocks" | "raw";

/**
 * The one editing state. In "blocks" mode the block list is the truth and the
 * markdown is derived; in "raw" mode the text is the truth and the blocks do
 * not exist. There is no third field that could drift out of sync.
 */
export type ComposerDraft =
  | { mode: "blocks"; blocks: SceneBlock[] }
  | { mode: "raw"; text: string };

/** Seed the draft from a file body — the composer is the default mode. */
export function composerDraft(body: string): ComposerDraft {
  return { mode: "blocks", blocks: parseBlocks(body) };
}

/** The markdown body the draft stands for — what „Speichern" writes. */
export function draftBody(draft: ComposerDraft): string {
  return draft.mode === "raw" ? draft.text : serializeBlocks(draft.blocks);
}

/**
 * Switch surfaces without losing a byte: Blöcke → Roh serializes, Roh → Blöcke
 * re-parses. A no-op switch returns the SAME object — re-parsing would hand out
 * fresh block ids and collapse every open form for nothing.
 */
export function withDraftMode(draft: ComposerDraft, mode: ComposerMode): ComposerDraft {
  if (draft.mode === mode) return draft;
  const body = draftBody(draft);
  return mode === "raw" ? { mode: "raw", text: body } : composerDraft(body);
}

/** The textarea typed (raw mode). */
export function withDraftText(text: string): ComposerDraft {
  return { mode: "raw", text };
}

/** A block list edit (blocks mode). */
export function withDraftBlocks(blocks: SceneBlock[]): ComposerDraft {
  return { mode: "blocks", blocks };
}

// --- addressing --------------------------------------------------------------

/** Where a new block goes: which list, and at which index in it. */
export interface InsertAt {
  /** The `## If:` section to insert into; undefined = the document itself. */
  sectionId?: string;
  index: number;
}

/** Same slot? (the picker is open at exactly one position at a time) */
export function sameInsertAt(a: InsertAt | undefined, b: InsertAt): boolean {
  return a !== undefined && a.index === b.index && a.sectionId === b.sectionId;
}

/**
 * Apply `change` to the list that CONTAINS `id` — the document's own list, or
 * the children of the one section holding it. Section children go back through
 * withChildren, so the section keeps its heading `source` (phase-1 rule 2).
 *
 * A `change` that returns its own argument means „nothing happened" and hands
 * back the caller's array unchanged, identity included: a move at the end of a
 * list must not re-render the block list for nothing.
 */
function inOwningList(
  blocks: SceneBlock[],
  id: string,
  change: (list: SceneBlock[]) => SceneBlock[],
): SceneBlock[] {
  if (blocks.some((block) => block.id === id)) return change(blocks);
  let touched = false;
  const next = blocks.map((block) => {
    if (block.type !== "ifSection") return block;
    if (!block.children.some((child) => child.id === id)) return block;
    const children = change(block.children);
    if (children === block.children) return block;
    touched = true;
    return withChildren(block, children);
  });
  return touched ? next : blocks;
}

/** Replace the one block with `id`, wherever it sits. */
function mapBlock(
  blocks: SceneBlock[],
  id: string,
  change: (block: SceneBlock) => SceneBlock,
): SceneBlock[] {
  return inOwningList(blocks, id, (list) =>
    list.map((block) => (block.id === id ? change(block) : block)),
  );
}

// --- editing -----------------------------------------------------------------

/**
 * The text of a block's one text field — for a section that is its condition.
 * Both paths go through a phase-1 helper, so `source` is dropped and the block
 * is rendered from its fields from here on.
 */
export function setBlockText(blocks: SceneBlock[], id: string, text: string): SceneBlock[] {
  return mapBlock(blocks, id, (block) =>
    block.type === "ifSection" ? withIfCondition(block, text) : withBlockText(block, text),
  );
}

/**
 * The level of a heading block. blocks.ts has no helper for the depth alone, so
 * the source is dropped by running the (unchanged) text through withBlockText —
 * a hand-rolled spread would keep the stale heading line and eat the change.
 */
export function setHeadingDepth(
  blocks: SceneBlock[],
  id: string,
  depth: HeadingBlock["depth"],
): SceneBlock[] {
  return mapBlock(blocks, id, (block) =>
    block.type === "heading" ? { ...withBlockText(block, block.text), depth } : block,
  );
}

/**
 * An `## If:` heading can sit on a gap of a single newline — as the last line
 * of a file (`## If: a\n`), or with its first child glued right underneath it
 * (`## If: a\ndrin\n`, valid markdown that a hand-written file may well hold).
 * A block inserted at the TOP of that section would then land directly under
 * the heading line, which is not the house style of examples/. Dropping the gap
 * hands the separator back to the serializer, which puts one blank line there.
 * Whitespace only: the heading's `source` stays, because the heading itself is
 * not what changed.
 *
 * Keyed on the POSITION, not on emptiness: an existing first child says nothing
 * about the heading's gap — it is exactly the case where the DM sees the glued
 * line and wants a block above it.
 */
function withRoomForChildren(section: IfSectionBlock): IfSectionBlock {
  if (section.gap === undefined || /\n[ \t]*\r?\n/.test(section.gap)) return section;
  return { ...section, gap: undefined };
}

/** Insert a fresh block into the document or into one section's children. */
export function insertAt(blocks: SceneBlock[], at: InsertAt, block: SceneBlock): SceneBlock[] {
  const { sectionId, index } = at;
  if (sectionId === undefined) return insertBlock(blocks, index, block);
  return blocks.map((candidate) => {
    if (candidate.type !== "ifSection" || candidate.id !== sectionId) return candidate;
    // Only the block right after the heading is affected by the heading's gap.
    const section = index <= 0 ? withRoomForChildren(candidate) : candidate;
    return withChildren(section, insertBlock(section.children, index, block));
  });
}

/**
 * Delete a block. Removing a section takes its children with it — the section
 * IS the `## If:` heading, and orphaned children under the previous heading
 * would silently change what they are conditional on.
 */
export function removeAt(blocks: SceneBlock[], id: string): SceneBlock[] {
  return inOwningList(blocks, id, (list) => removeBlock(list, id));
}

/**
 * Move a block one slot up (-1) or down (+1) WITHIN its list. At the ends
 * nothing happens: leaving the list would mean leaving (or entering) an
 * If-section, which is not part of this slice — the UI disables the button
 * there, this is the guard behind it.
 */
export function moveBy(blocks: SceneBlock[], id: string, delta: number): SceneBlock[] {
  return inOwningList(blocks, id, (list) => {
    const from = list.findIndex((block) => block.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= list.length) return list;
    return moveBlock(list, from, to);
  });
}

// --- what blocks a save ------------------------------------------------------

/**
 * The one German line the offending card shows. Deliberately a HINT with two
 * ways out, not a correction: `##` may be exactly what the DM meant to type,
 * and this module never rewrites their text.
 */
const SECTION_ESCAPE =
  "»##«-Überschrift beendet den Falls-Abschnitt — tiefer einstufen (###) oder Block nach außen ziehen.";

/**
 * What is WRONG in the block list right now, per block id — the line the card
 * shows under itself and the reason „Speichern" stays disabled. Same seam as
 * the frontmatter form's frontmatterFormIssues (issue #42): the state is
 * allowed to exist while the DM is typing, it just cannot be written.
 *
 * One rule, and it is the one the composer cannot survive silently: a child of
 * an `## If:` section whose markdown holds a heading that ENDS the section
 * (`#` or `##` at the start of a line — endsIfSectionText uses the parser's own
 * reading, so a `##` inside a code fence or a blockquote is fine). Saving that
 * writes a file whose next parse puts the child — and everything below it —
 * OUTSIDE the branch, while the composer still shows it nested. The DM would
 * have moved a whole branch by typing two characters.
 */
export function composerIssues(blocks: SceneBlock[]): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const block of blocks) {
    if (block.type !== "ifSection") continue;
    for (const child of block.children) {
      if (endsIfSectionText(blockMarkdown(child))) issues[child.id] = SECTION_ESCAPE;
    }
  }
  return issues;
}

// --- new blocks --------------------------------------------------------------

/** Which list the „+" belongs to — the document, or one If-section's children. */
export type BlockScope = "document" | "section";

/** One entry of the type picker. */
export interface NewBlockOption {
  /** Stable key for React and for tests. */
  key: string;
  label: string;
  /** Builds the block — always a phase-1 constructor, never a literal. */
  create: () => SceneBlock;
}

/**
 * The types a DM can add, in reading order: the six callouts the renderer knows
 * (in the order of CALLOUT_KINDS, so the picker matches the vocabulary of the
 * reading view), then the two plain blocks, then the section.
 *
 * Two entries differ inside a section, both for the same reason — the next
 * parse must find the same structure again:
 *   * no „Falls-Abschnitt": sections do not nest (a second `## If:` ends the
 *     first one), so a nested one would silently become a sibling.
 *   * a new heading starts at level 3: a `##` inside a section ENDS it, and the
 *     blocks below it would leave the section with it.
 */
export function newBlockOptions(scope: BlockScope): NewBlockOption[] {
  const options: NewBlockOption[] = CALLOUT_KINDS.map((kind) => ({
    key: `callout:${kind}`,
    label: calloutLabel(kind),
    create: () => makeCallout(kind, ""),
  }));
  options.push({
    key: "heading",
    label: "Überschrift",
    create: () => makeHeading(newHeadingDepth(scope), ""),
  });
  options.push({ key: "text", label: "Text", create: () => makeText("") });
  if (scope === "document") {
    options.push({ key: "ifSection", label: "Falls-Abschnitt", create: () => makeIfSection("") });
  }
  return options;
}

const ALL_DEPTHS: readonly HeadingBlock["depth"][] = [1, 2, 3, 4, 5, 6];

/**
 * The levels a heading may take here — see newBlockOptions for the `##` rule.
 * Inside a section the list is the format's own boundary (grammar.ts,
 * endsIfSection), not a second hard-coded „3".
 */
export function headingDepths(scope: BlockScope): HeadingBlock["depth"][] {
  if (scope === "document") return [...ALL_DEPTHS];
  return ALL_DEPTHS.filter((depth) => !endsIfSection(depth));
}

/** The level a NEW heading starts at: `##` in the document, the first level
 *  that does not end the section inside one. */
function newHeadingDepth(scope: BlockScope): HeadingBlock["depth"] {
  return scope === "document" ? 2 : (headingDepths(scope)[0] ?? 3);
}
