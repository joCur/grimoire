// The block model of the Block-Composer (issue #43, phase 1): parse a markdown
// BODY (frontmatter already stripped — same string as ParsedFile.body) into a
// flat-ish list of editable blocks and serialize it back.
//
// THE invariant, enforced by blocks.test.ts against every file in examples/:
//
//     serializeBlocks(parseBlocks(body)) === body     // byte-identical
//
// That is what makes a composer UI safe to point at hand-written files: opening
// a scene and saving it again must not produce a single byte of diff. The trick
// is that every parsed block keeps its own `source` verbatim and is re-rendered
// from its fields ONLY once it has been edited (see `source` below). Markdown
// has many equivalent spellings (`>text` vs `> text`, `## If:  x` vs
// `## If: x`, CRLF, blank-line runs) and this module never picks one for the
// DM — it picks one only for blocks the DM created or changed.
//
// Deliberately NOT a markdown parser: the scan is line-based (see splitLines /
// scan below). A real mdast parse cannot round-trip (it normalizes) and would
// have to be un-normalized again; and the format DEGRADES (README) — anything
// this module does not model becomes a raw block and survives verbatim instead
// of erroring. The alignment target for what IS modelled is the renderer:
// app/src/markdown/remark-grimoire.ts (callouts, `## If:` sections).
//
// No react, no query, no API imports — pure library, unit-testable.

import type { CalloutKind } from "@grimoire/shared/types";

// The format's own vocabulary and predicates — shared with the renderer so the
// composer can never model a document differently than the reading view shows
// it (app/src/markdown/grammar.ts).
import {
  CALLOUT_LABELS,
  CALLOUT_MARKER,
  endsIfSection,
  ifSectionCondition,
  isCalloutKind,
} from "@/markdown/grammar";

// --- the model ---------------------------------------------------------------

/**
 * Fields every block shares.
 *
 * The three optional strings are the round-trip machinery. Together they cover
 * the body without gaps: the body is exactly
 * `blocks.map(b => (b.lead ?? "") + body(b) + gap(b)).join("")` (see
 * serializeBlocks, which also flattens `ifSection` children into that list).
 */
interface BlockCommon {
  /**
   * Identity for React keys and drag & drop. Unique per process, NOT derived
   * from content and NOT stable across a re-parse — never persist it.
   */
  id: string;
  /**
   * The block's verbatim markdown, WITHOUT its terminating newline and without
   * the blank lines that separate it from the next block (those are `gap`).
   *
   * `source === undefined` IS the dirty flag: a block with a source serializes
   * byte-identically, a block without one is rendered from its fields. Every
   * edit helper here (withBlockText, withIfCondition) drops it, and the
   * constructors never set it.
   *
   * For an `ifSection` this is the `## If: …` HEADING LINE ALONE — the children
   * carry their own sources. Nothing is stored twice, so editing a child can
   * never be swallowed by a stale parent source.
   */
  source?: string;
  /**
   * Whitespace-only run that PRECEDED the block. The parser sets it on the
   * first block only (a body handed over by gray-matter starts with the blank
   * line after the frontmatter fence), which is why insertBlock/removeBlock/
   * moveBlock hand it along when the head of the list changes.
   */
  lead?: string;
  /**
   * Whitespace-only run that FOLLOWED the block: its own terminating newline
   * plus any blank lines up to the next block. `""` only at the end of a body
   * that has no trailing newline. Undefined on constructed blocks — the
   * serializer then inserts a blank line (or a single newline at the very end).
   *
   * A separator is not content: editing a block's text keeps its gap.
   */
  gap?: string;
}

/** One of the six known callouts (README, "Callouts"). */
export interface CalloutBlock extends BlockCommon {
  type: "callout";
  /** Canonical lowercase kind; `source` keeps the spelling as written. */
  kind: CalloutKind;
  /**
   * The callout's content: `>` markers and the `[!kind]` marker removed, line
   * breaks kept as "\n" (a callout may hold several paragraphs, separated by
   * an empty line just like in the file).
   */
  text: string;
}

/**
 * A `## If: <condition>` section: the heading plus everything up to the next
 * heading that ends it (grammar.ts, endsIfSection) or the end of the body —
 * exactly the grouping the renderer collapses into one `<details>`
 * (remark-grimoire, transformIfSections).
 * Sections never nest: a second `## If:` ends the first one.
 */
export interface IfSectionBlock extends BlockCommon {
  type: "ifSection";
  /** Everything after `If:`, trimmed. Raw markdown — may contain emphasis. */
  condition: string;
  /** The section's content as blocks (may be empty). */
  children: SceneBlock[];
}

/** Any other ATX heading (`# …` … `###### …`), including `## Flow`. */
export interface HeadingBlock extends BlockCommon {
  type: "heading";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** Heading text without the `#` markers and without a closing `##` run. */
  text: string;
}

/**
 * Plain markdown — a paragraph, a list, a table, a fenced code block, an HTML
 * comment. NOT parsed any further: `text` is verbatim markdown and the DM
 * edits it as such.
 */
export interface TextBlock extends BlockCommon {
  type: "text";
  text: string;
}

/**
 * The fallback that keeps the format degrading instead of validating: anything
 * structured that this module recognizes but does not model — a blockquote with
 * an UNKNOWN `[!kind]`, or a plain blockquote without any marker. `text` is
 * verbatim markdown (markers included), so a raw block never loses a byte and
 * is never silently reformatted into something else.
 */
export interface RawBlock extends BlockCommon {
  type: "raw";
  text: string;
  /** The unknown callout kind as written (lowercased), for the UI to name it. */
  calloutKind?: string;
}

export type SceneBlock = CalloutBlock | IfSectionBlock | HeadingBlock | TextBlock | RawBlock;

/** Blocks that carry one editable markdown/plain-text field called `text`. */
export type TextishBlock = CalloutBlock | HeadingBlock | TextBlock | RawBlock;

// --- ids ---------------------------------------------------------------------

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `blk${idCounter}`;
}

// --- lines -------------------------------------------------------------------

interface Line {
  /** Line content without its line terminator. */
  text: string;
  /** "\n", "\r\n" or "" for a last line without a terminator. */
  eol: string;
}

const EMPTY_LINE: Line = { text: "", eol: "" };

/**
 * Split into physical lines, each keeping its own terminator — so CRLF, mixed
 * endings and a missing final newline all survive re-assembly untouched.
 */
function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from < body.length) {
    const nl = body.indexOf("\n", from);
    if (nl === -1) {
      lines.push({ text: body.slice(from), eol: "" });
      break;
    }
    const crlf = nl > from && body[nl - 1] === "\r";
    lines.push({ text: body.slice(from, crlf ? nl - 1 : nl), eol: crlf ? "\r\n" : "\n" });
    from = nl + 1;
  }
  return lines;
}

function lineAt(lines: Line[], index: number): Line {
  return lines[index] ?? EMPTY_LINE;
}

// --- line classification -----------------------------------------------------
// Up to three leading spaces are still the same block in CommonMark; four make
// an indented code block, which is why every pattern below stops at three. That
// is what keeps `    > [!note] x` and `    ## If: x` inside a code block from
// being mistaken for structure.

const BLANK = /^[ \t]*$/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HEADING_CLOSER = /[ \t]+#+$/;
const BLOCKQUOTE = /^ {0,3}>/;
const QUOTE_MARKER = /^ {0,3}> ?/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_MARKER = /^ {0,3}(?:[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

function isBlank(text: string): boolean {
  return BLANK.test(text);
}

interface HeadingInfo {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

function headingOf(text: string): HeadingInfo | null {
  const match = ATX_HEADING.exec(text);
  if (match === null) return null;
  const depth = (match[1] ?? "#").length as HeadingInfo["depth"];
  // `## Foo ##` — the closing run is markup, not text (CommonMark).
  const body = (match[2] ?? "").replace(HEADING_CLOSER, "");
  return { depth, text: body };
}

/**
 * The condition of a `## If: …` heading, or null for any other heading — the
 * renderer's own predicate (grammar.ts), so a heading that collapses into a
 * `<details>` in the reading view becomes a section card here as well.
 */
function ifConditionOf(heading: HeadingInfo): string | null {
  return ifSectionCondition(heading.depth, heading.text);
}

/**
 * Does this markdown contain a line the parser would read as a heading that
 * ENDS an `## If:` section? The question the composer has to ask about every
 * child of a section: a `##` typed into a child pulls that child — and
 * everything under it — out of the branch on the next parse (lib/composer.ts,
 * composerIssues).
 *
 * Uses the parser's own reading, which is what makes it trustworthy: a `##`
 * inside a code fence, in a blockquote or in an indented code block is not a
 * heading and does not end anything.
 */
export function endsIfSectionText(markdown: string): boolean {
  const lines = splitLines(markdown);
  for (let i = 0; i < lines.length; i++) {
    const text = lineAt(lines, i).text;
    const fence = FENCE.exec(text);
    if (fence !== null) {
      i = fenceEnd(lines, i, fence[1] ?? "```");
      continue;
    }
    const heading = headingOf(text);
    if (heading !== null && endsIfSection(heading.depth)) return true;
  }
  return false;
}

/**
 * Does this line end the current plain chunk? Blank lines separate chunks, and
 * headings, blockquotes and code fences are blocks of their own. List markers
 * and thematic breaks deliberately do NOT end a chunk — that is what keeps a
 * tight list (and a `---` inside one) together as a single editable block.
 */
function endsChunk(text: string): boolean {
  if (isBlank(text)) return true;
  if (headingOf(text) !== null) return true;
  if (BLOCKQUOTE.test(text)) return true;
  return FENCE.test(text);
}

/**
 * Would this line start a new block rather than continue the paragraph above
 * it? The CommonMark "paragraph interrupters", used to decide whether a line
 * without a `>` marker is a lazy blockquote continuation.
 */
function interruptsParagraph(text: string): boolean {
  if (endsChunk(text)) return true;
  if (THEMATIC_BREAK.test(text)) return true;
  return LIST_MARKER.test(text);
}

/** Strip one `>` marker (plus its single following space, per CommonMark). */
function stripQuoteMarker(text: string): string {
  const match = QUOTE_MARKER.exec(text);
  return match === null ? text : text.slice(match[0].length);
}

// --- source slicing ----------------------------------------------------------

/** Verbatim lines `from`..`to` joined by their own terminators, last one open. */
function sliceSource(lines: Line[], from: number, to: number): string {
  let out = "";
  for (let i = from; i <= to; i++) {
    out += lineAt(lines, i).text;
    if (i < to) out += lineAt(lines, i).eol;
  }
  return out;
}

interface Gap {
  gap: string;
  next: number;
}

/** The terminator of line `last` plus every blank line that follows it. */
function takeGap(lines: Line[], last: number): Gap {
  let gap = lineAt(lines, last).eol;
  let i = last + 1;
  while (i < lines.length && isBlank(lineAt(lines, i).text)) {
    gap += lineAt(lines, i).text + lineAt(lines, i).eol;
    i += 1;
  }
  return { gap, next: i };
}

// --- parsing -----------------------------------------------------------------

/**
 * Parse a markdown body into blocks.
 *
 * Segmentation of plain markdown: ONE text block per blank-line-separated
 * chunk, plus a chunk break before every heading, blockquote and fenced code
 * block (all of which interrupt a paragraph in CommonMark). So a paragraph is
 * one card, a tight list is one card, a code fence is one card — which is how
 * the DM reads the file. The two known costs, both harmless because every
 * block keeps its `source`: a LOOSE list (blank lines between items) splits
 * into one block per item, and a setext heading (`Titel` + `=====`) stays a
 * text block instead of becoming a heading block. Both still round-trip
 * byte-identically; only editing them is less convenient than editing the rest.
 */
export function parseBlocks(body: string): SceneBlock[] {
  const lines = splitLines(body);

  // Whitespace before the first block. gray-matter hands over the blank line
  // that followed the frontmatter fence, so this is the normal case.
  let start = 0;
  let lead = "";
  while (start < lines.length && isBlank(lineAt(lines, start).text)) {
    lead += lineAt(lines, start).text + lineAt(lines, start).eol;
    start += 1;
  }

  if (start >= lines.length) {
    // Empty or whitespace-only body. An empty body has nothing to carry the
    // whitespace, so a whitespace-only one gets a single empty text block —
    // it round-trips (source "" and gap "" reproduce exactly the whitespace
    // that was there) AND gives the composer something to type into. Typing
    // drops the source, and the serializer then gives the block the trailing
    // newline every file in the data set has.
    if (lead === "") return [];
    return [{ id: nextId(), type: "text", text: "", source: "", lead, gap: "" }];
  }

  const [blocks] = scan(lines, start, false);
  const first = blocks[0];
  if (first !== undefined && lead !== "") first.lead = lead;
  return blocks;
}

/**
 * Scan blocks from `from`. Inside an `## If:` section the scan returns as soon
 * as a heading ENDS the section — literally the renderer's own predicate
 * (grammar.ts, endsIfSection; remark-grimoire uses it for the same boundary).
 */
function scan(lines: Line[], from: number, inIfSection: boolean): [SceneBlock[], number] {
  const blocks: SceneBlock[] = [];
  let i = from;

  while (i < lines.length) {
    const line = lineAt(lines, i);
    const heading = headingOf(line.text);

    if (heading !== null) {
      if (inIfSection && endsIfSection(heading.depth)) break; // the section ends here
      const condition = ifConditionOf(heading);
      const { gap, next } = takeGap(lines, i);
      if (condition !== null) {
        const [children, afterSection] = scan(lines, next, true);
        blocks.push({
          id: nextId(),
          type: "ifSection",
          condition,
          children,
          source: line.text,
          gap,
        });
        i = afterSection;
        continue;
      }
      blocks.push({
        id: nextId(),
        type: "heading",
        depth: heading.depth,
        text: heading.text,
        source: line.text,
        gap,
      });
      i = next;
      continue;
    }

    if (BLOCKQUOTE.test(line.text)) {
      const last = blockquoteEnd(lines, i);
      const { gap, next } = takeGap(lines, last);
      blocks.push(blockquoteBlock(sliceSource(lines, i, last), gap));
      i = next;
      continue;
    }

    const fence = FENCE.exec(line.text);
    if (fence !== null) {
      // Consumed as one block so that blank lines INSIDE the fence do not
      // split it — and so that its `#`/`>` lines are never read as structure.
      const last = fenceEnd(lines, i, fence[1] ?? "```");
      const { gap, next } = takeGap(lines, last);
      const fenceSource = sliceSource(lines, i, last);
      blocks.push({ id: nextId(), type: "text", text: fenceSource, source: fenceSource, gap });
      i = next;
      continue;
    }

    // Plain chunk: up to the next blank line or interrupting block start.
    let last = i;
    while (last + 1 < lines.length && !endsChunk(lineAt(lines, last + 1).text)) {
      last += 1;
    }
    const { gap, next } = takeGap(lines, last);
    const source = sliceSource(lines, i, last);
    blocks.push({ id: nextId(), type: "text", text: source, source, gap });
    i = next;
  }

  return [blocks, i];
}

/**
 * Last line of the blockquote starting at `from`: every following `>` line,
 * plus lazy continuation lines (a line without a marker that would just
 * continue the quoted paragraph) — the same reading remark/CommonMark applies.
 */
function blockquoteEnd(lines: Line[], from: number): number {
  let last = from;
  while (last + 1 < lines.length) {
    const next = lineAt(lines, last + 1).text;
    if (BLOCKQUOTE.test(next)) {
      last += 1;
      continue;
    }
    const lazyPossible = !isBlank(stripQuoteMarker(lineAt(lines, last).text));
    if (lazyPossible && !interruptsParagraph(next)) {
      last += 1;
      continue;
    }
    break;
  }
  return last;
}

/** Last line of the fenced code block starting at `from` (EOF closes it). */
function fenceEnd(lines: Line[], from: number, opener: string): number {
  const char = opener[0] ?? "`";
  const closer = new RegExp(`^ {0,3}${char === "`" ? "`" : "~"}{${opener.length},}[ \\t]*$`);
  for (let i = from + 1; i < lines.length; i++) {
    if (closer.test(lineAt(lines, i).text)) return i;
  }
  return lines.length - 1;
}

/** A blockquote run: a known callout, or a raw block (the degrade path). */
function blockquoteBlock(source: string, gap: string): CalloutBlock | RawBlock {
  const content = source.split("\n").map((line) => stripQuoteMarker(line.replace(/\r$/, "")));
  const firstIndex = content.findIndex((line) => !isBlank(line));
  const first = firstIndex === -1 ? "" : (content[firstIndex] ?? "");
  const marker = CALLOUT_MARKER.exec(first);

  if (marker === null) {
    // A plain blockquote — not modelled, kept verbatim.
    return { id: nextId(), type: "raw", text: source, source, gap };
  }

  const kind = (marker[1] ?? "").toLowerCase();
  if (!isCalloutKind(kind)) {
    // Unknown kind: exactly what the renderer does — leave it alone.
    return { id: nextId(), type: "raw", text: source, source, gap, calloutKind: kind };
  }

  const body = [first.slice(marker[0].length), ...content.slice(firstIndex + 1)]
    .join("\n")
    // `> [!note]` with the text starting on the next line: the soft break right
    // after the marker is markup, not content (remark-grimoire does the same).
    .replace(/^\n/, "");

  return { id: nextId(), type: "callout", kind, text: body, source, gap };
}

// --- serializing -------------------------------------------------------------

interface Unit {
  lead: string;
  body: string;
  /** undefined = constructed block, the serializer picks the separator. */
  gap: string | undefined;
  /** True when `body` came from a `source` and must not be touched at all. */
  verbatim: boolean;
}

/**
 * Serialize blocks back to a markdown body.
 *
 * Untouched blocks (those that still carry a `source`) are emitted verbatim,
 * which is what makes the round-trip byte-identical. Blocks without a source —
 * constructed or edited — are rendered from their fields in the house style of
 * examples/ and separated by one blank line; the last one gets a single
 * trailing newline, because every file in the data set ends with exactly one.
 *
 * Two rules about EMPTINESS, both of them „the file gets what the DM meant,
 * the composer keeps what the DM is working on":
 *
 *   * An edited or constructed block that renders to NOTHING contributes
 *     nothing at all — not even its separator. The card stays on screen (it is
 *     draft state, and a freshly inserted block is empty by definition), it
 *     just does not write a stray blank line into the file, and it therefore
 *     also cannot vanish differently on the way through „Roh" and back.
 *     Parsing never produces such a block; only editing does.
 *   * An edited LAST block that ended the body without a newline gets one:
 *     every file in the data set ends with exactly one. A body that genuinely
 *     has no final newline and is not touched stays as it is (its blocks are
 *     verbatim), so nothing is normalized behind the DM's back.
 */
export function serializeBlocks(blocks: SceneBlock[]): string {
  const all: Unit[] = [];
  flatten(blocks, all);
  const units = withoutEmpty(all);
  if (units.length === 0) return "";

  // The line ending is a property of the FILE, so it is read from everything
  // that was there — the dropped units included.
  const eol = dominantEol(all);
  return units
    .map((unit, index) => {
      const isLast = index === units.length - 1;
      const gap = unit.gap ?? (isLast ? eol : eol + eol);
      // Rendered bodies are built with "\n"; verbatim ones already carry the
      // file's own endings and must never be rewritten (that would turn a
      // "\r\n" into "\r\r\n").
      const body = unit.verbatim ? unit.body : unit.body.replace(/\n/g, eol);
      const end = isLast && !unit.verbatim && gap === "" ? eol : gap;
      return unit.lead + body + end;
    })
    .join("");
}

/**
 * Drop the units that render to nothing, and hand their WHITESPACE on — it
 * belongs to the position in the list, never to the block that happens to sit
 * there (same rule as the list operations below):
 *
 *   * `lead` (for the first block: the blank line gray-matter left behind the
 *     frontmatter fence) moves forward to whatever is first now,
 *   * a dropped unit at the END of the list gives its gap — the file's own
 *     terminator — to the unit that is last now, so emptying the last block
 *     leaves `A\n` and not `A\n\n`.
 */
function withoutEmpty(units: Unit[]): Unit[] {
  const kept: Unit[] = [];
  let carried = "";
  let terminator: string | undefined;
  let atTail = false;
  for (const unit of units) {
    if (!unit.verbatim && unit.body === "") {
      carried += unit.lead;
      terminator = unit.gap;
      atTail = true;
      continue;
    }
    kept.push(carried === "" ? unit : { ...unit, lead: carried + unit.lead });
    carried = "";
    atTail = false;
  }
  const last = kept[kept.length - 1];
  if (atTail && last !== undefined) {
    // A terminator of "" (a file that ends without a newline) is not inherited:
    // the block that carried it was EDITED away, and the serializer's default
    // gives the new last block the single trailing newline the data set has.
    kept[kept.length - 1] = { ...last, gap: terminator === "" ? undefined : terminator };
  }
  return kept;
}

function flatten(blocks: SceneBlock[], units: Unit[]): void {
  for (const block of blocks) {
    const source = block.source;
    units.push({
      lead: block.lead ?? "",
      body: source ?? renderBlock(block),
      gap: block.gap,
      verbatim: source !== undefined,
    });
    if (block.type === "ifSection") flatten(block.children, units);
  }
}

/**
 * A CRLF body stays CRLF even where new blocks were inserted: the line ending
 * is a property of the file, not of the block that happens to be new.
 *
 * `lead` counts as evidence like everything else: in a CRLF file whose body
 * starts with the blank line after the frontmatter fence and holds a single
 * block, that blank line is the ONLY place a "\r\n" can be seen.
 */
function dominantEol(units: Unit[]): string {
  for (const unit of units) {
    if (unit.lead.includes("\r\n")) return "\r\n";
    if (unit.gap !== undefined && unit.gap.includes("\r\n")) return "\r\n";
    if (unit.body.includes("\r\n")) return "\r\n";
  }
  return "\n";
}

/**
 * The markdown one block stands for: its verbatim `source` while it is
 * untouched, otherwise what its fields render to. The serializer's own reading
 * of a block, exported because the composer's validation has to ask the same
 * question (lib/composer.ts, composerIssues).
 */
export function blockMarkdown(block: SceneBlock): string {
  return block.source ?? renderBlock(block);
}

/** The markdown of one block, rendered from its fields (house style). */
function renderBlock(block: SceneBlock): string {
  switch (block.type) {
    case "callout":
      return renderCallout(block.kind, block.text);
    case "ifSection":
      return block.condition === "" ? "## If:" : `## If: ${block.condition}`;
    case "heading":
      return block.text === "" ? "#".repeat(block.depth) : `${"#".repeat(block.depth)} ${block.text}`;
    default:
      return block.text;
  }
}

/**
 * House style for a callout (examples/, generator/example-output.md): the
 * `[!kind]` marker and the text start on the SAME line, every line carries a
 * `> ` marker, an empty line inside the callout is a bare `>`.
 *
 * The examples wrap their prose at ~70 columns, but new blocks are serialized
 * UNWRAPPED — a soft break is a byte the DM did not type, re-wrapping edited
 * text would move lines the DM never touched, and the renderer collapses soft
 * breaks anyway. Hand-written wrapping in existing blocks is of course
 * preserved (their `source` is).
 */
function renderCallout(kind: string, text: string): string {
  const lines = text.split("\n");
  const first = lines[0] ?? "";
  const head = first === "" ? `> [!${kind}]` : `> [!${kind}] ${first}`;
  const rest = lines.slice(1).map((line) => (line === "" ? ">" : `> ${line}`));
  return [head, ...rest].join("\n");
}

// --- constructors ------------------------------------------------------------
// Constructed blocks carry no `source` and no `gap`: the serializer renders
// them and places the separator. Text is normalized (surrounding blank lines
// and trailing spaces dropped) so that parse(serialize(block)) yields the same
// block again — the fixpoint blocks.test.ts checks.

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "");
}

export function makeCallout(kind: CalloutKind, text: string): CalloutBlock {
  return { id: nextId(), type: "callout", kind, text: normalizeText(text) };
}

export function makeIfSection(condition: string, children: SceneBlock[] = []): IfSectionBlock {
  return { id: nextId(), type: "ifSection", condition: condition.trim(), children };
}

export function makeHeading(depth: HeadingBlock["depth"], text: string): HeadingBlock {
  return { id: nextId(), type: "heading", depth, text: text.trim() };
}

export function makeText(text: string): TextBlock {
  return { id: nextId(), type: "text", text: normalizeText(text) };
}

// --- editing -----------------------------------------------------------------

/** The block's editable text; for a section that is its condition. */
export function blockText(block: SceneBlock): string {
  return block.type === "ifSection" ? block.condition : block.text;
}

/**
 * Replace a block's text. Returns a COPY without `source` — from here on the
 * block is rendered from its fields, while every sibling stays byte-identical.
 * `lead`/`gap` survive: a separator is not content.
 */
export function withBlockText<B extends TextishBlock>(block: B, text: string): B {
  // `source: undefined` reads the same as an absent source everywhere here
  // (`source ?? render(block)`), and keeps the generic member type intact.
  return { ...block, text, source: undefined } as B;
}

/** Replace an `## If:` condition (same dirty semantics as withBlockText). */
export function withIfCondition(block: IfSectionBlock, condition: string): IfSectionBlock {
  return { ...block, condition, source: undefined };
}

/** Replace a section's children (the children keep their own sources). */
export function withChildren(block: IfSectionBlock, children: SceneBlock[]): IfSectionBlock {
  return { ...block, children };
}

// --- list operations ---------------------------------------------------------
//
// Whitespace is POSITIONAL, not part of the block: `lead` is the whitespace in
// front of the list (for a body from gray-matter: the blank line after the
// frontmatter fence), the last gap is the file's terminator ("\n", or "" for a
// file without a final newline) and the gaps in between are separators.
//
// So a structural change permutes the block bodies and leaves that scaffolding
// where it is. Moving the first block must not drag the leading blank line
// along, deleting the last block must not leave its trailing blank line behind,
// and a block appended after a `\n`-only gap must get its blank line — which is
// exactly what these three do. Phase 2 should use them instead of splicing
// arrays by hand.

interface Scaffold {
  /** Blocks stripped of lead/gap, in list order. */
  bare: SceneBlock[];
  /** Separator after block i, for i < bare.length - 1. */
  separators: (string | undefined)[];
  /** Whitespace after the LAST block. */
  terminator: string | undefined;
  /** Whitespace in front of the first block. */
  lead: string | undefined;
}

function decompose(blocks: SceneBlock[]): Scaffold {
  const gaps = blocks.map((block) => block.gap);
  return {
    bare: blocks.map((block) => ({ ...block, lead: undefined, gap: undefined })),
    separators: gaps.slice(0, -1),
    terminator: gaps[gaps.length - 1],
    lead: blocks[0]?.lead,
  };
}

function compose(scaffold: Scaffold): SceneBlock[] {
  const { bare, separators, terminator, lead } = scaffold;
  return bare.map((block, index) => ({
    ...block,
    lead: index === 0 ? lead : undefined,
    gap: index === bare.length - 1 ? terminator : separators[index],
  }));
}

/** Insert `block` at `index` (clamped). The new block gets a blank line of room. */
export function insertBlock(blocks: SceneBlock[], index: number, block: SceneBlock): SceneBlock[] {
  const at = Math.max(0, Math.min(index, blocks.length));
  const { bare, separators, terminator, lead } = decompose(blocks);
  return compose({
    bare: [...bare.slice(0, at), { ...block, lead: undefined, gap: undefined }, ...bare.slice(at)],
    // undefined = "serializer, pick the separator" (one blank line).
    separators: [...separators.slice(0, at), undefined, ...separators.slice(at)],
    terminator,
    lead,
  });
}

/** Remove the block with `id` (this list only, not inside sections). */
export function removeBlock(blocks: SceneBlock[], id: string): SceneBlock[] {
  const at = blocks.findIndex((block) => block.id === id);
  if (at === -1) return blocks;
  const { bare, separators, terminator, lead } = decompose(blocks);
  // One separator disappears with the block; the terminator stays the terminator.
  const drop = Math.min(at, Math.max(0, separators.length - 1));
  return compose({
    bare: bare.filter((_, index) => index !== at),
    separators: separators.filter((_, index) => index !== drop),
    terminator,
    lead,
  });
}

/** Move the block at `from` to `to` (both clamped). Separators stay put. */
export function moveBlock(blocks: SceneBlock[], from: number, to: number): SceneBlock[] {
  if (from < 0 || from >= blocks.length) return blocks;
  const { bare, separators, terminator, lead } = decompose(blocks);
  const moved = bare[from];
  if (moved === undefined) return blocks;
  const rest = [...bare.slice(0, from), ...bare.slice(from + 1)];
  const at = Math.max(0, Math.min(to, rest.length));
  return compose({
    bare: [...rest.slice(0, at), moved, ...rest.slice(at)],
    separators,
    terminator,
    lead,
  });
}

// --- labels ------------------------------------------------------------------

// German UI labels. The six callout names are the format's own (grammar.ts,
// CALLOUT_LABELS — the words the reading view shows); only the composer's four
// structural names are added here.

/** Label of one callout kind — for a "new block" picker, where there is no block yet. */
export function calloutLabel(kind: CalloutKind): string {
  return CALLOUT_LABELS[kind];
}

export function blockLabel(block: SceneBlock): string {
  switch (block.type) {
    case "callout":
      return CALLOUT_LABELS[block.kind];
    case "ifSection":
      return "Falls-Abschnitt";
    case "heading":
      return "Überschrift";
    case "text":
      return "Text";
    default:
      return "Roh-Block";
  }
}
