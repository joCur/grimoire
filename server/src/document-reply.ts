// The RAW document reply (issue #107).
//
// Until this ticket every document call — a pipeline scene part, a pipeline
// entry part, the NPC run, the augment run — asked the model for JSON with the
// whole markdown file embedded as a string value. That is the most fragile
// place in the pipeline: a complete document carries newlines, backslashes and
// quotation marks, and each of them has to survive JSON escaping. The PO case
// of 15.09. was exactly that — a scene that was CORRECT and unparseable,
// because the model wrote German quotation marks with an ASCII closing `"`
// and that `"` ended the JSON string.
//
// So the reply IS the document now: frontmatter block plus body, byte for byte
// as it will be stored. Warnings follow after a delimiter line:
//
//     ---
//     id: night-watch-quay
//     …
//     ---
//
//     ## Flow
//     …
//
//     ---warnings---
//     Der Quelltext nennt keinen DC — DC 13 gesetzt.
//
// No warnings block means no warnings. The document half goes through the
// SAME shared Markdown parser and the SAME validators as before
// (generator.ts) — this module only splits and un-wraps; it never judges
// content.
//
// What it tolerates, and why: a model that was asked for a markdown document
// tends to fence it (```markdown) and to put a sentence in front of it
// („Hier ist die Szene:"). Neither changes the document, and a correction turn
// for either resends the whole prompt plus the whole reply at full price. So
// both are stripped — but only as long as the frontmatter start is still
// findable, which is the one thing a document cannot do without.
//
// `extractJsonReply` (generator.ts) survives for the OUTLINE alone: that step
// answers a small, flat object and is the one call where JSON is the honest
// shape (issue #107, Zuschnitt 1).

/** The line that separates the document from its warnings. */
export const WARNINGS_DELIMITER = "---warnings---";

/**
 * How the delimiter is RECOGNIZED — deliberately wider than how it is
 * documented: two or more dashes on each side and any casing, because a model
 * that got the word right and a dash wrong has said what it meant.
 */
const WARNINGS_LINE = /^[ \t]*-{2,}[ \t]*warnings[ \t]*-{2,}[ \t]*$/i;

/** A line that is nothing but a code fence (with or without a language). */
const FENCE_LINE = /^[ \t]*`{3,}[ \t]*[a-zA-Z0-9_-]*[ \t]*$/;
/** A line that CLOSES a fence — backticks and nothing else. */
const FENCE_CLOSE = /^[ \t]*`{3,}[ \t]*$/;
/** The frontmatter delimiter of the data format: three dashes, alone. */
const FRONTMATTER_LINE = /^[ \t]*-{3}[ \t]*$/;

export interface DocumentReply {
  /** The document, frontmatter block included, exactly as it will be stored. */
  content: string;
  /** One warning per line of the warnings block; empty when there was none. */
  warnings: string[];
}

/**
 * The error a reply that is not a document gets back — German, because it
 * travels into the (German) correction turn. It names the ONE thing that was
 * missing, so the model has something to fix instead of a verdict.
 */
export const NOT_A_DOCUMENT_ERROR =
  "die Antwort ist kein Dokument — sie muss mit dem Frontmatter-Block beginnen " +
  "(eine Zeile `---`, darunter die Schlüssel, darunter wieder eine Zeile `---`), " +
  "danach folgt der Fließtext; Warnungen stehen erst nach einer Zeile " +
  `\`${WARNINGS_DELIMITER}\`, eine je Zeile. Kein JSON, keine Code-Zäune.`;

/**
 * Split one raw model reply into document and warnings.
 *
 * Order matters: the warnings block is cut off FIRST, so a model that put its
 * warnings outside a fenced document and one that put them inside end up in
 * the same place. Then the fence comes off, then the leading prose.
 *
 * Returns the error message for the correction turn when no frontmatter start
 * can be found — and only then.
 */
export function parseDocumentReply(
  raw: string,
): { ok: true; reply: DocumentReply } | { ok: false; error: string } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cut = lastIndexWhere(lines, (line) => WARNINGS_LINE.test(line));
  const documentLines = cut === -1 ? lines : lines.slice(0, cut);
  const warnings = cut === -1 ? [] : warningsOf(lines.slice(cut + 1));

  const unfenced = stripFence(documentLines);
  const start = frontmatterStart(unfenced);
  if (start === -1) return { ok: false, error: NOT_A_DOCUMENT_ERROR };
  // The document keeps its trailing newline: that is how a file is stored,
  // and the renderer's own output ends that way too.
  const content = `${unfenced.slice(start).join("\n").trimEnd()}\n`;
  return { ok: true, reply: { content, warnings } };
}

/** Index of the LAST matching line, or -1 (Array.findLastIndex needs es2023). */
function lastIndexWhere(
  lines: readonly string[],
  match: (line: string, index: number) => boolean,
): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (match(lines[i] as string, i)) return i;
  }
  return -1;
}

/** One warning per non-empty line; list bullets and stray fences fall off. */
function warningsOf(lines: readonly string[]): string[] {
  return lines
    .filter((line) => !FENCE_LINE.test(line))
    .map((line) => line.replace(/^[ \t]*[-*][ \t]+/, "").trim())
    .filter((line) => line !== "");
}

/**
 * The content of a surrounding code fence, or the lines unchanged.
 *
 * The fence has to OPEN before the document does — a fence line below the
 * frontmatter start belongs to the body (a model may legitimately fence a
 * table or a snippet inside a scene) and is left alone. The CLOSING fence is
 * the last backtick-only line, so a fenced block inside the document cannot
 * cut the reply short.
 */
function stripFence(lines: readonly string[]): readonly string[] {
  const open = lines.findIndex((line) => line.trim() !== "");
  if (open === -1) return lines;
  const opener = lines.findIndex((line) => FENCE_LINE.test(line));
  const document = lines.findIndex((line) => FRONTMATTER_LINE.test(line));
  if (opener === -1 || (document !== -1 && document < opener)) return lines;
  const close = lastIndexWhere(lines, (line, i) => i > opener && FENCE_CLOSE.test(line));
  return lines.slice(opener + 1, close === -1 ? undefined : close);
}

/**
 * Index of the line the document starts at: the `---` that opens the
 * frontmatter block. The FIRST non-empty line is the well-behaved case;
 * anything above it is prose the model wrote about its answer and is dropped —
 * but only for a `---` that is actually the OPENING one, i.e. one with another
 * `---` below it. Without that pair there is no frontmatter block and no
 * document, whatever else the reply contains.
 */
function frontmatterStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (!FRONTMATTER_LINE.test(lines[i] as string)) continue;
    const close = lines.findIndex((line, j) => j > i && FRONTMATTER_LINE.test(line));
    return close === -1 ? -1 : i;
  }
  return -1;
}
