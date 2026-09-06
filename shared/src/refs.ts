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
  return splitEntityRefs(text)
    .map((piece) => {
      if (piece.type === "text") return piece.value;
      const name = nameOf(piece.slug);
      return name === undefined || name === "" ? entityRefSource(piece.slug) : name;
    })
    .join("");
}
