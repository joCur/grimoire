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
// What it does NOT touch is anything AFTER the document: a trailing sentence
// is kept verbatim as body text. Guessing there means guessing whether a
// closing sentence is the model signing off or the last line of the scene,
// and a wrong guess deletes the DM's content without a trace. The prompts
// forbid the sign-off instead (generator/*-system-prompt.md).
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
/**
 * A frontmatter KEY line. At least one of them has to stand between the two
 * `---` lines, otherwise the pair is not a frontmatter block at all: a reply
 * that separates two prose paragraphs with two horizontal rules looks exactly
 * like `---` … `---` and used to parse as a document with an empty
 * frontmatter (issue #107 review).
 */
const KEY_LINE = /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/;
export interface DocumentReply {
  /** The document, frontmatter block included, exactly as it will be stored. */
  content: string;
  /** One warning per line of the warnings block; empty when there was none. */
  warnings: string[];
}

/**
 * The one rule that keeps a reply a document, in the exact wording the
 * document prompts carry („## Ausgabeformat" in scene-single-output.md,
 * npc-, location- and augment-system-prompt.md — minus their `**` emphasis).
 *
 * It exists as a constant because the CORRECTION turn has to say the same
 * thing (generator.buildCorrectionMessage): trailing chatter is no longer
 * stripped, so the prompt is the only place it is prevented, and a correction
 * turn that repeated a softer rule would teach the model the softer rule.
 */
export const NO_TEXT_AROUND_DOCUMENT_RULE =
  "Vor dem Dokument und nach dem Dokument steht nichts — keine Anrede, keine " +
  "Erklärung, kein Schlusssatz: das Einzige, was nach dem Dokument stehen darf, " +
  `ist der \`${WARNINGS_DELIMITER}\`-Block.`;

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
  // A BOM from an endpoint that wrote UTF-8 with a signature would otherwise
  // sit in front of the frontmatter `---` and make the reply "not a document".
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const { body, tail } = splitFence(lines);

  // Where the warnings block is looked for: after the closing fence first —
  // that is where a model that fenced its document usually puts it — and
  // otherwise inside the document, where only a line OUTSIDE a fenced region
  // counts. A `---warnings---` in a fenced example block is example text.
  const tailCut = lastIndexWhere(tail, (line) => WARNINGS_LINE.test(line));
  const bodyCut =
    tailCut === -1
      ? lastIndexWhere(body, (line, i) => WARNINGS_LINE.test(line) && !insideFence(body, i))
      : -1;
  const warnings =
    tailCut !== -1
      ? warningsOf(tail.slice(tailCut + 1))
      : bodyCut !== -1
        ? warningsOf(body.slice(bodyCut + 1))
        : [];
  const documentLines = bodyCut === -1 ? body : body.slice(0, bodyCut);

  const start = frontmatterStart(documentLines);
  if (start === -1) return { ok: false, error: NOT_A_DOCUMENT_ERROR };
  // Everything from the frontmatter start on IS the document, trailing prose
  // included. There used to be a heuristic here that cut a structureless
  // trailing block off an unfenced reply („Ich hoffe, das passt so!"), and it
  // could not tell a sign-off from a plain closing sentence after a callout or
  // a table — so it silently deleted real content. Visible chatter the DM
  // deletes in the review is the cheaper failure; the prompt side is where
  // this is prevented (generator/README.md).
  //
  // The document keeps its trailing newline: that is how a file is stored,
  // and the renderer's own output ends that way too.
  const content = `${documentLines.slice(start).join("\n").trimEnd()}\n`;
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

/**
 * One warning per non-empty line; stray fences fall off and so does the
 * leading marker of a list — `-`, `*`, `+` or a number (`1.`, `1)`). A model
 * that numbered its warnings meant the text, not the number.
 */
function warningsOf(lines: readonly string[]): string[] {
  return lines
    .filter((line) => !FENCE_LINE.test(line))
    .map((line) => line.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, "").trim())
    .filter((line) => line !== "");
}

/**
 * The reply split at a SURROUNDING code fence: `body` is what the fence
 * contains (or the whole reply when there is none), `tail` is what stood
 * below the closing fence — and `tail.length > 0` is also how the rest of
 * this module knows the reply WAS fenced.
 *
 * The fence has to OPEN before the document does — a fence line below the
 * frontmatter start belongs to the body (a model may legitimately fence a
 * table or a snippet inside a scene) and is left alone. The CLOSING fence is
 * the last backtick-only line, so a fenced block inside the document cannot
 * cut the reply short.
 */
function splitFence(lines: readonly string[]): {
  body: readonly string[];
  tail: readonly string[];
} {
  const opener = lines.findIndex((line) => FENCE_LINE.test(line));
  const document = lines.findIndex((line) => FRONTMATTER_LINE.test(line));
  if (opener === -1 || (document !== -1 && document < opener)) return { body: lines, tail: [] };
  const close = lastIndexWhere(lines, (line, i) => i > opener && FENCE_CLOSE.test(line));
  if (close === -1) return { body: lines.slice(opener + 1), tail: [""] };
  return { body: lines.slice(opener + 1, close), tail: lines.slice(close + 1) };
}

/** Whether line `i` stands inside a fenced region of `lines`. */
function insideFence(lines: readonly string[], i: number): boolean {
  let open = false;
  for (let j = 0; j < i; j += 1) {
    if (FENCE_LINE.test(lines[j] as string)) open = !open;
  }
  return open;
}

/**
 * Index of the line the document starts at: the `---` that opens the
 * frontmatter block. That has to be the FIRST `---` of the block — a leading
 * sentence about the answer is dropped, but a reply whose first `---` is a
 * horizontal rule in prose is not a document with prose above it, it is prose
 * with a rule in it. And the pair has to have a closing `---` below it with
 * at least one `key:` line in between; two horizontal rules are not a
 * frontmatter block.
 */
function frontmatterStart(lines: readonly string[]): number {
  const open = lines.findIndex((line) => FRONTMATTER_LINE.test(line));
  if (open === -1) return -1;
  const close = lines.findIndex((line, j) => j > open && FRONTMATTER_LINE.test(line));
  if (close === -1) return -1;
  const keys = lines.slice(open + 1, close);
  if (!keys.some((line) => KEY_LINE.test(line))) return -1;
  return open;
}
