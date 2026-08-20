// Pure helpers for the generator view (issue #12). Everything here is
// derivation and formatting — no fetching, no state:
//
//   - the "Neues Kapitel" flow needs a chapter id BEFORE anything exists:
//     the next free numeric prefix from the tree plus a kebab slug of the
//     title (the path preview shows exactly what apply will create).
//   - the review preview renders the body of a draft the user may have
//     edited as raw markdown, so the frontmatter block has to be split off
//     client-side (same rule as the server's parser: it degrades, it never
//     throws).
//   - German count labels for the context hint and the apply button.

/** German umlauts/ß first — NFKD would strip them to bare vowels. */
const UMLAUTS: Array<[RegExp, string]> = [
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"],
];

/**
 * Kebab-case slug of a chapter title, mirroring the ids in the data format
 * (README: `01-salzhafen`): lowercase ASCII words joined by single dashes.
 * Returns "" when the title has no usable characters.
 */
export function slugify(title: string): string {
  let text = title.toLowerCase();
  for (const [pattern, replacement] of UMLAUTS) text = text.replace(pattern, replacement);
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks of decomposed accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Next free chapter prefix: max numeric prefix of the existing chapter ids
 * plus one, zero-padded to the widest existing prefix (at least two
 * digits). Chapters without a numeric prefix are ignored; no chapters at
 * all -> "01".
 */
export function nextChapterPrefix(chapterIds: readonly string[]): string {
  let max = 0;
  let width = 2;
  for (const id of chapterIds) {
    const match = /^(\d+)/.exec(id);
    if (match === null) continue;
    const digits = match[1] as string;
    max = Math.max(max, Number(digits));
    width = Math.max(width, digits.length);
  }
  return String(max + 1).padStart(width, "0");
}

/**
 * The directory name a new chapter would get: `<next prefix>-<slug>`.
 * Undefined while the title yields no slug — then there is nothing honest
 * to preview yet.
 */
export function newChapterId(title: string, chapterIds: readonly string[]): string | undefined {
  const slug = slugify(title);
  if (slug === "") return undefined;
  return `${nextChapterPrefix(chapterIds)}-${slug}`;
}

/**
 * Body of a complete markdown file (frontmatter block stripped) — the same
 * shape the server's parser returns, so the review preview can run the
 * normal markdown pipeline over an edited draft. Degrades: without a
 * parseable block the whole text IS the body.
 */
export function markdownBody(markdown: string): string {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) return markdown;
  const lines = markdown.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] as string).trimEnd() === "---") {
      return lines.slice(i + 1).join("\n").replace(/^\r?\n/, "");
    }
  }
  return markdown;
}

/** German count label: `1 Szene` / `3 Szenen` (also used for 0). */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Summary inside the apply button: "2 Szenen · 1 Stub". */
export function applySummary(sceneCount: number, stubCount: number): string {
  return `${countLabel(sceneCount, "Szene", "Szenen")} · ${countLabel(stubCount, "Stub", "Stubs")}`;
}

/**
 * The context hint under the source textarea: what the server will send
 * along with the prompt (npc/location names + the glossary, see
 * generator/README.md step 1).
 */
export function contextHint(npcCount: number, locationCount: number, hasGlossary: boolean): string {
  return [
    countLabel(npcCount, "NPC", "NPCs"),
    countLabel(locationCount, "Ort", "Orte"),
    hasGlossary ? "Glossar" : "kein Glossar",
  ].join(" · ");
}

/** Strings out of an error body field (`validationErrors`, `conflicts`). */
export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
