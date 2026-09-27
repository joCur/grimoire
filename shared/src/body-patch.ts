// Changing ONE block of a markdown body, addressed by its text — what a
// generator patch does to the body of a proposal (decisions/generator: an
// answer to a note patches the proposal instead of writing it again).
//
// A block is what the block model cuts a body into (./blocks.ts): a
// paragraph, a callout, a heading, an `## If:` section with everything it
// holds, or one of the blocks inside such a section. An operation names its
// block by its complete text — the ANCHOR — and the anchor has to hit exactly
// one block, compared with every run of whitespace read as one space. Every
// other byte of the body stays as it is: the operation splices the body at
// the block's own place in it and touches nothing around that place.
//
// The operations are zod schemas so the job that stores them and the reply
// that brings them share one shape (./generator-job.ts).

import { z } from "zod";
import { blockTreeMarkdown, parseBlocks, type SceneBlock } from "./blocks";

/** Put `text` where the anchored block stands. */
export const blockReplaceSchema = z.strictObject({
  op: z.enum(["replace"]),
  anchor: z.string(),
  text: z.string(),
});

/** Put `text` right after the anchored block, as a block of its own. */
export const blockInsertSchema = z.strictObject({
  op: z.enum(["insertAfter"]),
  anchor: z.string(),
  text: z.string(),
});

/** Take the anchored block out of the body. */
export const blockRemoveSchema = z.strictObject({
  op: z.enum(["remove"]),
  anchor: z.string(),
});

/** One operation on a body's blocks. */
export const bodyOperationSchema = z.union([
  blockReplaceSchema,
  blockInsertSchema,
  blockRemoveSchema,
]);

export type BodyOperation = z.infer<typeof bodyOperationSchema>;

/**
 * Why an operation cannot be applied: its anchor hits no block (`missing`)
 * or more than one (`ambiguous`), or it brings no text where it needs one
 * (`empty`).
 */
export type BodyPatchFailure = "missing" | "ambiguous" | "empty";

/** A block as it stands in its body: where its text starts and ends. */
interface Placed {
  block: SceneBlock;
  /** Offset of the block's first character. */
  start: number;
  /** Offset just past the block's last character — for a section, its last child's. */
  end: number;
}

/** Every run of whitespace as one space, and none at either end. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Every block of the body with its place in it — the top-level blocks and the
 * blocks inside each `## If:` section, in the order the body holds them.
 * Parsed blocks carry their verbatim source, so the offsets add up to the body
 * exactly (the block model's round-trip).
 */
function placedBlocks(body: string): Placed[] {
  const placed: Placed[] = [];
  let offset = 0;
  const visit = (block: SceneBlock): void => {
    offset += (block.lead ?? "").length;
    const start = offset;
    placed.push({ block, start, end: start + blockTreeMarkdown(block).length });
    offset += (block.source ?? "").length + (block.gap ?? "").length;
    if (block.type === "ifSection") block.children.forEach(visit);
  };
  parseBlocks(body).forEach(visit);
  return placed;
}

/** The index of the one placed block `anchor` names, or why there is none. */
function locate(
  placed: Placed[],
  anchor: string,
): { ok: true; index: number } | { ok: false; reason: BodyPatchFailure } {
  const wanted = normalize(anchor);
  if (wanted === "") return { ok: false, reason: "missing" };
  const hits: number[] = [];
  placed.forEach((candidate, index) => {
    if (normalize(blockTreeMarkdown(candidate.block)) === wanted) hits.push(index);
  });
  if (hits.length === 0) return { ok: false, reason: "missing" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, index: hits[0]! };
}

/** The text of the one block `anchor` names, as the body holds it — or why there is none. */
export function findAnchor(
  body: string,
  anchor: string,
): { ok: true; markdown: string } | { ok: false; reason: BodyPatchFailure } {
  const placed = placedBlocks(body);
  const hit = locate(placed, anchor);
  if (!hit.ok) return hit;
  const { start, end } = placed[hit.index]!;
  return { ok: true, markdown: body.slice(start, end) };
}

/**
 * The text an operation brings, as the body will hold it: no blank lines
 * around it, no trailing whitespace, and the body's own line ending.
 */
function blockText(text: string, eol: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "")
    .replace(/\n/g, eol);
}

/**
 * Apply one operation to a body. Only the anchored block's own place changes:
 *
 *   replace      the block's text becomes `text`, the whitespace around it
 *                stays;
 *   insertAfter  `text` follows the block, one blank line between them;
 *   remove       the block goes together with the whitespace that separates
 *                it from its neighbour, so no blank line is left behind.
 */
export function applyBodyOperation(
  body: string,
  operation: BodyOperation,
): { ok: true; body: string } | { ok: false; reason: BodyPatchFailure } {
  const placed = placedBlocks(body);
  const hit = locate(placed, operation.anchor);
  if (!hit.ok) return hit;
  const { start, end } = placed[hit.index]!;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  if (operation.op === "remove") {
    const after = placed.slice(hit.index + 1).find((candidate) => candidate.start >= end);
    if (after !== undefined) {
      return { ok: true, body: body.slice(0, start) + body.slice(after.start) };
    }
    // The last block: the separator before it goes, the body's own ending stays.
    const before = placed[hit.index - 1];
    if (before === undefined) return { ok: true, body: "" };
    const beforeEnd = before.start + (before.block.source ?? "").length;
    const ending = body.slice(end).includes("\n") ? eol : "";
    return { ok: true, body: body.slice(0, beforeEnd) + ending };
  }
  const text = blockText(operation.text, eol);
  if (text === "") return { ok: false, reason: "empty" };
  if (operation.op === "replace") {
    return { ok: true, body: body.slice(0, start) + text + body.slice(end) };
  }
  return { ok: true, body: body.slice(0, end) + eol + eol + text + body.slice(end) };
}

