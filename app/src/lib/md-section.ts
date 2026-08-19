// Tiny line-based extractor for "first paragraph under a `## <heading>`"
// lookups (chapter goal, NPC "Will"). Deliberately not a full markdown
// parse — these are display hints and DEGRADE: no heading / no paragraph
// simply yields undefined, never an error.

/**
 * Returns the first paragraph below the H2 with the given text (exact
 * match, case-insensitive, surrounding whitespace ignored), with soft
 * line breaks collapsed to spaces. Undefined when the heading or the
 * paragraph is missing.
 */
export function firstParagraphOfSection(body: string, heading: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex(
    (line) => /^##(?!#)/.test(line.trim()) && line.trim().replace(/^##\s*/, "").trim().toLowerCase() === wanted,
  );
  if (start === -1) return undefined;

  const paragraph: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") {
      if (paragraph.length > 0) break;
      continue; // skip blank lines between heading and paragraph
    }
    if (/^#{1,6}\s/.test(line) || /^#{1,6}$/.test(line)) break; // next heading, no paragraph
    paragraph.push(line);
  }
  if (paragraph.length === 0) return undefined;
  return paragraph.join(" ");
}
