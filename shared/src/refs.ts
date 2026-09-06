// Entity references in BODY TEXT (issue #68): `[[slug]]`.
//
// The format keeps the SLUG, forever — never the name. The name is looked up
// when the text is RENDERED (app/src/markdown/remark-grimoire.ts + EntityRef),
// so a rename of the display name is visible everywhere at once and the old
// gap ("prose mentions keep the stale name") closes structurally.
//
// This module is the grammar, once, for the three parties that read it:
//
//   app/src/markdown/remark-grimoire.ts   the renderer's mdast pass
//   server/src/store/refs.ts              FTS expansion + the rename cascade
//   generator/system-prompt.md            what the model is told to emit
//
// Deliberate non-features:
//
//   * NO alias syntax (`[[slug|Text]]`). A hand-written label is exactly the
//     stale name the feature exists to remove, and it would need its own
//     indexing rule. German inflection works without it: `[[jorna]]s Boot`
//     renders as "Jornas Boot" because the suffix stays outside the ref.
//   * only a KEBAB-CASE slug is a reference (`[[jorna]]`, `[[alte-mole]]`).
//     `[[Jorna]]`, `[[a b]]` and `[[]]` are plain text — same rule as the
//     rename endpoint's `newId`, so anything that can be a reference is
//     something that can be an id.

/**
 * The entity kinds a body reference can point at, IN RESOLUTION ORDER.
 *
 * Slugs are unique per kind, not across kinds, so a collision has to have a
 * documented winner: an npc beats a location beats a scene. Rationale: at the
 * table the DM names people far more often than rooms, and scenes are the
 * kind whose ids are the most technical (`smuggler-captured`) — the least
 * likely to be typed into prose by accident.
 *
 * Chapters are deliberately NOT referenceable (issue #68 scope): nothing in
 * the reading flow points at a chapter mid-sentence.
 */
export const ENTITY_REF_KINDS = ["npc", "location", "scene"] as const;
export type EntityRefKind = (typeof ENTITY_REF_KINDS)[number];

/** A kebab-case slug — the only thing `[[…]]` accepts (see the note above). */
const REF_SLUG_SOURCE = "[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * A fresh global matcher for `[[slug]]`; `[1]` is the slug. A new instance per
 * call on purpose — a shared global regex carries `lastIndex` between callers.
 */
export function entityRefMatcher(): RegExp {
  return new RegExp(`\\[\\[(${REF_SLUG_SOURCE})\\]\\]`, "g");
}

/** Is this the whole text of one reference (used by tests and the composer)? */
export function isEntityRefSlug(value: string): boolean {
  return new RegExp(`^${REF_SLUG_SOURCE}$`).test(value);
}

/** How a reference is written — the one place that spells the brackets. */
export function entityRefSource(slug: string): string {
  return `[[${slug}]]`;
}

/** One piece of a body text: literal text, or a reference to a slug. */
export type EntityRefPiece = { type: "text"; value: string } | { type: "ref"; slug: string };

/**
 * Split a text into literal pieces and references. Text without references
 * comes back as a single text piece (the renderer uses that to leave the
 * mdast node completely untouched).
 */
export function splitEntityRefs(text: string): EntityRefPiece[] {
  const pieces: EntityRefPiece[] = [];
  const matcher = entityRefMatcher();
  let last = 0;
  for (let match = matcher.exec(text); match !== null; match = matcher.exec(text)) {
    const slug = match[1];
    if (slug === undefined) continue;
    if (match.index > last) pieces.push({ type: "text", value: text.slice(last, match.index) });
    pieces.push({ type: "ref", slug });
    last = match.index + match[0].length;
  }
  if (pieces.length === 0) return [{ type: "text", value: text }];
  if (last < text.length) pieces.push({ type: "text", value: text.slice(last) });
  return pieces;
}

/** Every referenced slug in a text, first-seen order, without duplicates. */
export function entityRefSlugs(text: string): string[] {
  const slugs: string[] = [];
  for (const piece of splitEntityRefs(text)) {
    if (piece.type === "ref" && !slugs.includes(piece.slug)) slugs.push(piece.slug);
  }
  return slugs;
}

/**
 * Replace every reference by its display name — the text a reader SEES.
 *
 * The server indexes this for full-text search (store/refs.ts), so a body
 * that only says `[[jorna]]` is findable under "Jorna" and the search snippet
 * reads like the rendered page. An unresolved slug keeps its brackets, in the
 * index exactly as on screen.
 */
export function expandEntityRefs(
  text: string,
  nameOf: (slug: string) => string | undefined,
): string {
  return renderEntityRefPieces(splitEntityRefs(text), nameOf);
}

/** Render already-split pieces — the resolution rule, once. */
export function renderEntityRefPieces(
  pieces: readonly EntityRefPiece[],
  nameOf: (slug: string) => string | undefined,
): string {
  return pieces
    .map((piece) => {
      if (piece.type === "text") return piece.value;
      const name = nameOf(piece.slug);
      return name === undefined || name === "" ? entityRefSource(piece.slug) : name;
    })
    .join("");
}

// --- CODE REGIONS in a raw body ---------------------------------------------
//
// A reference is prose syntax, and CODE IS NOT PROSE: `` `[[jorna]]` `` and
// anything inside a fenced block render literally, so nothing may touch them —
// not the search-index expansion, not the rename cascade. The renderer gets
// that for free (mdast `inlineCode`/`code` carry no text children); everything
// that works on the RAW body needs this segmenter to see the same regions.
//
// The rules are CommonMark's, at the precision a body actually needs:
// a fence is ``` or ~~~ (3+, up to three spaces of indent, closed by a run of
// at least the same length of the same character or by the end of the text),
// and a code span is a run of n backticks closed by the next run of exactly n
// — never across a blank line, because a blank line ends the paragraph.

/** One region of a raw body: prose, or code that must stay untouched. */
export interface BodySegment {
  code: boolean;
  value: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

function isBlankLineAt(text: string, index: number): boolean {
  // `index` points at a "\n"; is the NEXT line blank?
  let i = index + 1;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  return i >= text.length || text[i] === "\n";
}

/** Split a fence-free text into prose and code SPANS (`` `…` ``). */
function splitCodeSpans(text: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let plainFrom = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let open = 0;
    while (text[i + open] === "`") open += 1;
    let j = i + open;
    let close = -1;
    while (j < text.length) {
      if (text[j] === "`") {
        let run = 0;
        while (text[j + run] === "`") run += 1;
        if (run === open) {
          close = j;
          break;
        }
        j += run;
        continue;
      }
      if (text[j] === "\n" && isBlankLineAt(text, j)) break;
      j += 1;
    }
    if (close === -1) {
      // An unclosed run is literal backticks — plain text, keep scanning.
      i += open;
      continue;
    }
    if (i > plainFrom) segments.push({ code: false, value: text.slice(plainFrom, i) });
    segments.push({ code: true, value: text.slice(i, close + open) });
    i = close + open;
    plainFrom = i;
  }
  if (plainFrom < text.length) segments.push({ code: false, value: text.slice(plainFrom) });
  return segments;
}

/**
 * Split a raw markdown body into prose and CODE regions (fenced blocks and
 * inline code spans). Concatenating the values gives the input back, byte for
 * byte — that is what makes a code-aware rewrite non-destructive.
 */
export function splitCodeSegments(text: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const push = (code: boolean, value: string): void => {
    if (value === "") return;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.code === code) last.value += value;
    else segments.push({ code, value });
  };

  const parts = text.split("\n");
  let prose = "";
  let fenceMarker: string | undefined;
  const flushProse = (): void => {
    if (prose === "") return;
    for (const segment of splitCodeSpans(prose)) push(segment.code, segment.value);
    prose = "";
  };

  parts.forEach((line, index) => {
    const raw = index === parts.length - 1 ? line : `${line}\n`;
    if (fenceMarker !== undefined) {
      push(true, raw);
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closing !== null) {
        const run = closing[1] ?? "";
        if (run[0] === fenceMarker[0] && run.length >= fenceMarker.length) fenceMarker = undefined;
      }
      return;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening !== null) {
      flushProse();
      fenceMarker = opening[1];
      push(true, raw);
      return;
    }
    prose += raw;
  });
  flushProse();
  return segments;
}

/** Map only the PROSE regions of a raw body; code comes back untouched. */
function mapProse(text: string, fn: (prose: string) => string): string {
  if (!text.includes("`") && !text.includes("~")) return fn(text);
  return splitCodeSegments(text)
    .map((segment) => (segment.code ? segment.value : fn(segment.value)))
    .join("");
}

/**
 * `expandEntityRefs` for a RAW body: references inside code regions keep
 * their brackets, so the indexed text says what the page shows.
 */
export function expandBodyEntityRefs(
  text: string,
  nameOf: (slug: string) => string | undefined,
): string {
  return mapProse(text, (prose) => expandEntityRefs(prose, nameOf));
}

/** Rewrite `[[oldSlug]]` to `[[newSlug]]` in the PROSE of a raw body. */
export function rewriteBodyEntityRefs(text: string, oldSlug: string, newSlug: string): string {
  const to = entityRefSource(newSlug);
  return mapProse(text, (prose) =>
    splitEntityRefs(prose)
      .map((piece) =>
        piece.type === "text"
          ? piece.value
          : piece.slug === oldSlug
            ? to
            : entityRefSource(piece.slug),
      )
      .join(""),
  );
}

/** Does the PROSE of a raw body reference this slug? (Code does not count.) */
export function bodyReferencesEntity(text: string, slug: string): boolean {
  if (!text.includes(entityRefSource(slug))) return false;
  return splitCodeSegments(text).some(
    (segment) =>
      !segment.code &&
      splitEntityRefs(segment.value).some(
        (piece) => piece.type === "ref" && piece.slug === slug,
      ),
  );
}
