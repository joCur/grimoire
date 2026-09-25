// The augment review's arithmetic.
//
// Two levels, and which is which matters:
//
//   DECISION UNIT = the BLOCK. The proposal arrives as two whole bodies
//   (current + proposed) and is cut here into the Block-Composer's own blocks
//   (lib/blocks.ts) — paragraph, callout, `## If:` section, heading, raw. The
//   DM accepts or keeps each one; nothing else is a choice.
//
//   VISIBILITY = the WORD. Inside a CHANGED block only the words that
//   actually differ are highlighted, the rest stays neutral — a git-like
//   word diff, so one changed word reads as one changed word and not as two
//   rewritten paragraphs.
//
// Plus the raw editor's line/word diff over the WHOLE body, which is the same
// machinery one level up: lines aligned, and inside a changed line the same
// word diff again.
//
// DEFAULTS never overwrite silently: a block the proposal ADDS is
// preselected, a block it CHANGES is not. Same rule for the fields, one level
// up in the component: `new` accepted, `changed` kept.
//
// Pure library: no react, no query, no API. The serialization back into a
// body goes through `serializeBlocks`, so an accepted-nothing review produces
// the byte-identical original (blocks.ts' round-trip invariant).

import {
  blockTreeMarkdown,
  parseBlocks,
  serializeBlocks,
  type SceneBlock,
} from "@/lib/blocks";

// --- word diff ----------------------------------------------------------------

export interface DiffToken {
  text: string;
  kind: "same" | "added" | "removed";
}

/**
 * Beyond this many tokens on either side the quadratic LCS is not worth its
 * cost — and nothing at that size reads as a "word diff" anyway. The block
 * then shows as one removed and one added run, which is exactly what a
 * complete rewrite is.
 */
const WORD_DIFF_LIMIT = 1200;

/**
 * Split into diff tokens: words and the whitespace between them, each its own
 * token so re-joining is lossless (`tokens.join("") === text`). Whitespace
 * tokens are carried along by whichever side they belong to, which is what
 * keeps a one-word change from dragging its neighbours' spaces into the
 * highlight.
 */
export function tokenizeWords(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Longest common subsequence of two token lists, as index pairs.
 *
 * The full n*m table is kept on purpose: the walk below reads it BACKWARDS to
 * recover the pairs, and a row-at-a-time fill would only give the length.
 * What keeps it affordable is the caller's bound — `WORD_DIFF_LIMIT` on both
 * sides — not the fill strategy.
 */
function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const lengths: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** Append a token run, merging into the previous one of the same kind. */
function push(out: DiffToken[], kind: DiffToken["kind"], text: string): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === kind) last.text += text;
  else out.push({ text, kind });
}

/**
 * A git-like word diff of two texts. Unchanged words come back as `same`,
 * so a renderer can print the whole block and highlight only what moved.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
  if (before === after) return before === "" ? [] : [{ text: before, kind: "same" }];
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);
  const out: DiffToken[] = [];
  if (a.length > WORD_DIFF_LIMIT || b.length > WORD_DIFF_LIMIT) {
    push(out, "removed", before);
    push(out, "added", after);
    return out;
  }
  const pairs = lcsPairs(a, b);
  let i = 0;
  let j = 0;
  for (const [ai, bj] of pairs) {
    push(out, "removed", a.slice(i, ai).join(""));
    push(out, "added", b.slice(j, bj).join(""));
    push(out, "same", a[ai]!);
    i = ai + 1;
    j = bj + 1;
  }
  push(out, "removed", a.slice(i).join(""));
  push(out, "added", b.slice(j).join(""));
  return out;
}

// --- line diff (the raw editor's tab) -------------------------------------------

export interface DiffLine {
  kind: "same" | "added" | "removed" | "changed";
  /** The line as it stands now — absent for an added line. */
  before?: string;
  /** The proposed line — absent for a removed line. */
  after?: string;
  /** Word diff inside a `changed` line; absent for every other kind. */
  words?: DiffToken[];
}

/**
 * How similar two units have to be to count as ONE changed unit — a rewritten
 * line in the raw diff, a rewritten block in the review. Below it they are an
 * honest remove plus an honest add, and the add keeps its "take"
 * default.
 */
const PAIR_SIMILARITY = 0.4;

/** Words of a text without the whitespace tokens. */
function words(text: string): string[] {
  return tokenizeWords(text).filter((token) => token.trim() !== "");
}

/**
 * How many tokens the two sides share, as a bag — order-blind, linear, and
 * within a few percent of the LCS ratio for the texts this decides about.
 * It is what a pair too large for the quadratic LCS is measured with.
 */
function bagOverlap(a: readonly string[], b: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let common = 0;
  for (const token of b) {
    const left = counts.get(token) ?? 0;
    if (left === 0) continue;
    counts.set(token, left - 1);
    common += 1;
  }
  return common;
}

/**
 * 0…1 — how much of two texts is the same words. The LCS is quadratic, so
 * beyond `WORD_DIFF_LIMIT` on either side the cheap bag ratio decides
 * instead: this runs once per candidate PAIR inside a flush, and an unbounded
 * LCS there made a big paste cost minutes.
 */
export function similarity(a: string, b: string): number {
  if (a === "" || b === "") return 0;
  const tokensA = words(a);
  const tokensB = words(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const common =
    tokensA.length > WORD_DIFF_LIMIT || tokensB.length > WORD_DIFF_LIMIT
      ? bagOverlap(tokensA, tokensB)
      : lcsPairs(tokensA, tokensB).length;
  return (2 * common) / (tokensA.length + tokensB.length);
}

/**
 * A line diff over the whole body, with a word diff inside every line that
 * merely CHANGED — the raw editor's view of the proposal.
 *
 * A removed line and an added line that face each other and are similar
 * enough are folded into one `changed` line; everything else stays an honest
 * add or remove.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  const pairs = lcsPairs(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  const flush = (removed: string[], added: string[]): void => {
    const shared = Math.min(removed.length, added.length);
    let paired = 0;
    while (
      paired < shared &&
      similarity(removed[paired]!, added[paired]!) >= PAIR_SIMILARITY
    ) {
      const beforeLine = removed[paired]!;
      const afterLine = added[paired]!;
      out.push({
        kind: "changed",
        before: beforeLine,
        after: afterLine,
        words: wordDiff(beforeLine, afterLine),
      });
      paired += 1;
    }
    for (const line of removed.slice(paired)) out.push({ kind: "removed", before: line });
    for (const line of added.slice(paired)) out.push({ kind: "added", after: line });
  };
  for (const [ai, bj] of pairs) {
    flush(a.slice(i, ai), b.slice(j, bj));
    out.push({ kind: "same", before: a[ai]!, after: a[ai]! });
    i = ai + 1;
    j = bj + 1;
  }
  flush(a.slice(i), b.slice(j));
  return out;
}

// --- block alignment ------------------------------------------------------------

export type BlockChangeKind =
  /** Byte-identical in both bodies — no decision, shown quietly. */
  | "same"
  /** Only in the proposal — a new paragraph/callout/If-section. */
  | "added"
  /** In both, but rewritten — the word diff sits inside this one. */
  | "changed"
  /**
   * Only in the CURRENT body: the proposal dropped it. The augmentation rule
   * forbids that, so it is shown as a decision whose default is "keep" —
   * accepting it is what deletes the block, and that never happens by itself.
   */
  | "removed";

export interface BlockChange {
  /** Stable within one alignment — the review's react key and selection id. */
  id: string;
  kind: BlockChangeKind;
  /** The block as it stands (absent for `added`). */
  before?: SceneBlock;
  /** The proposed block (absent for `removed`). */
  after?: SceneBlock;
  /** Word diff of the two markdown texts — only for `changed`. */
  words?: DiffToken[];
}

/**
 * Cut the two bodies into blocks and align them — the block is the unit of
 * decision. The alignment is an LCS over the blocks' verbatim markdown, so
 * everything the model left untouched — which the augmentation rule says is
 * most of it — matches exactly and is not a decision at all.
 *
 * A removed and an added block that face each other at the same position AND
 * are similar enough (the line diff's own threshold) are folded into one
 * `changed` block, which is what carries the before/after and the word diff.
 * Everything else stays an honest add or remove.
 */
export function alignBlocks(currentBody: string, proposedBody: string): BlockChange[] {
  const current = parseBlocks(currentBody);
  const proposed = parseBlocks(proposedBody);
  // An `## If:` section is compared and shown as a WHOLE (heading + body):
  // `blockMarkdown` answers for the heading line alone, which made a NEW
  // section show as a bare heading in the review, and a section whose body
  // alone changed align as `same`.
  const a = current.map(blockTreeMarkdown);
  const b = proposed.map(blockTreeMarkdown);
  const pairs = lcsPairs(a, b);
  const out: BlockChange[] = [];
  let counter = 0;
  const id = (): string => {
    counter += 1;
    return `aug${counter}`;
  };
  const flush = (removed: SceneBlock[], added: SceneBlock[]): void => {
    const shared = Math.min(removed.length, added.length);
    // Facing each other is not enough to be the SAME block rewritten — the
    // gate is the one the line diff uses. Without it a dropped callout and an
    // unrelated new paragraph became one "changed" row, which both hid the
    // deletion and cost the addition its "take" default.
    let paired = 0;
    while (
      paired < shared &&
      similarity(blockTreeMarkdown(removed[paired]!), blockTreeMarkdown(added[paired]!)) >=
        PAIR_SIMILARITY
    ) {
      const beforeBlock = removed[paired]!;
      const afterBlock = added[paired]!;
      out.push({
        id: id(),
        kind: "changed",
        before: beforeBlock,
        after: afterBlock,
        words: wordDiff(blockTreeMarkdown(beforeBlock), blockTreeMarkdown(afterBlock)),
      });
      paired += 1;
    }
    for (const block of removed.slice(paired)) {
      out.push({ id: id(), kind: "removed", before: block });
    }
    for (const block of added.slice(paired)) {
      out.push({ id: id(), kind: "added", after: block });
    }
  };
  let i = 0;
  let j = 0;
  for (const [ai, bj] of pairs) {
    flush(current.slice(i, ai), proposed.slice(j, bj));
    out.push({ id: id(), kind: "same", before: current[ai]!, after: proposed[bj]! });
    i = ai + 1;
    j = bj + 1;
  }
  flush(current.slice(i), proposed.slice(j));
  return out;
}

/**
 * The default decision per block: take what is NEW, keep what is
 * filled. A `changed` block is therefore NOT preselected — accepting it is
 * the DM's explicit act — and a `removed` one never is, because accepting
 * that deletes text.
 */
export function defaultAccepted(changes: readonly BlockChange[]): Set<string> {
  return new Set(changes.filter((change) => change.kind === "added").map((change) => change.id));
}

/** True when this block is a decision at all (a `same` block is not). */
export function isDecision(change: BlockChange): boolean {
  return change.kind !== "same";
}

/**
 * The body the accept writes: every block in order, with the accepted side
 * of each decision.
 *
 * With nothing accepted this is the current body again, byte for byte —
 * blocks.ts' round-trip invariant is what makes that true, and it is the
 * reason a keep-everything review can be sent without special-casing.
 */
export function assembleBody(
  changes: readonly BlockChange[],
  accepted: ReadonlySet<string>,
): string {
  const blocks: SceneBlock[] = [];
  for (const change of changes) {
    const take = accepted.has(change.id);
    switch (change.kind) {
      case "same":
        blocks.push(change.before!);
        break;
      case "added":
        if (take) blocks.push(change.after!);
        break;
      case "changed":
        blocks.push(take ? change.after! : change.before!);
        break;
      case "removed":
        // Accepting a removal is the only way a block disappears.
        if (!take) blocks.push(change.before!);
        break;
    }
  }
  return serializeBlocks(blocks);
}

// --- the fields half --------------------------------------------------------------

/**
 * One field of a proposal, as the review renders it: the stored value and the
 * proposed one side by side.
 *
 * `state` is what the DEFAULT decision hangs off (never silently overwrite):
 * `new` means the row has no value for the field and the proposal is
 * preselected; `changed` means it HAS a value and the model wants a different
 * one — the default there is to keep the stored value. A field the proposal
 * leaves alone is not listed at all; `current` is absent exactly when the row
 * holds nothing there.
 */
export interface FieldProposal {
  key: string;
  current?: unknown;
  proposed: unknown;
  state: "new" | "changed";
}

/**
 * A rendered field value — the review shows the stored and the proposed value
 * as text, and a list or a mapping has to read as one line rather than as
 * `[object Object]`.
 */
export function formatPropertyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => formatPropertyValue(item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${formatPropertyValue(item)}`)
      .join(", ");
  }
  return String(value);
}
