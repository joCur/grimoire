// Parsing pieces of an entry's BODY — the text side of the store.
//
// Two things live here, and both are read by write paths:
//
//   * `logLineShortHash` — the short hash of a raw session log line. It is
//     the identity the review's `reviewed` flag is keyed by, so the log
//     append (store/write.ts) and the rename cascade (store/rename.ts) have
//     to compute it exactly the same way.
//   * `parseGlossaryBody` and the section helpers under it — `PUT /entry` for
//     the `glossary` address takes the rendered term list back as ONE
//     markdown text and has to decompose it into rows again.
//
// The rule from ADR #1 holds throughout: NOTHING here throws, and nothing is
// silently dropped. A line the grammar does not recognise keeps its text and
// travels on with its parsed fields empty; the caller decides what that is
// worth.

import { createHash } from "node:crypto";

/**
 * Short hash of one raw session log line — the key the review's `reviewed`
 * flag hangs on. Eight hex characters of sha256 over the line as stored.
 */
export function logLineShortHash(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
}

// --- sections ----------------------------------------------------------------

export interface MarkdownSection {
  /** Heading text without the `#`s; undefined for the text before the first heading. */
  heading?: string;
  /** Heading level 1–6; undefined for the preamble. */
  level?: number;
  /** The heading line verbatim; undefined for the preamble. */
  headingLine?: string;
  /** Lines BELOW the heading (the heading itself is not included). */
  lines: string[];
  /** Index of the heading line in the body's line array; -1 for the preamble. */
  startIndex: number;
  /** Index one PAST the section's last line — the next heading, or the end. */
  endIndex: number;
}

/**
 * An ATX heading, recognised the way the APP recognises one
 * (app/src/lib/session.ts: `/^#{1,6}(\s|$)/`): one to six `#` followed by
 * whitespace or the end of the line.
 *
 * The space is MANDATORY. Without it every hashtag line a body puts in —
 * `#pause`, `#thread`, `#decision` (README, "Hashtags") — would read as a
 * heading and cut a section in half.
 *
 * The `#` must also sit at the very START of the line: an indented `#` is not
 * a heading in markdown (it is code), and the app's reader is the yardstick
 * for what the DM actually saw. A trailing `\r` is tolerated so CRLF text
 * parses the same as LF text — the line itself is never rewritten, so the
 * `\r` survives into the stored body.
 */
const HEADING = /^(#{1,6})(?=[ \t\r]|$)[ \t]*(.*?)[ \t\r]*$/;

/** A fenced code block's delimiter (``` or ~~~), optionally indented. */
const FENCE = /^[ \t]{0,3}((?:`{3,})|(?:~{3,}))[ \t]*(.*?)[ \t\r]*$/;

interface HeadingInfo {
  level: number;
  text: string;
}

/**
 * The body's lines with the heading lines marked. Fenced code blocks are
 * tracked so a `# comment` inside a ``` block is never a section boundary —
 * a wrong boundary is silent content loss on the way back into rows, which
 * weighs more than the app's simpler reader.
 */
function scanLines(lines: readonly string[]): (HeadingInfo | undefined)[] {
  const out: (HeadingInfo | undefined)[] = [];
  /** The open fence's marker, or undefined outside a code block. */
  let fence: string | undefined;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (f !== null) {
      const marker = f[1] ?? "";
      if (fence === undefined) {
        fence = marker;
        out.push(undefined);
        continue;
      }
      // A closing fence is the same character, at least as long, and carries
      // no info string.
      if (marker[0] === fence[0] && marker.length >= fence.length && (f[2] ?? "") === "") {
        fence = undefined;
      }
      out.push(undefined);
      continue;
    }
    if (fence !== undefined) {
      out.push(undefined);
      continue;
    }
    const m = HEADING.exec(line);
    out.push(m === null ? undefined : { level: (m[1] ?? "#").length, text: m[2] ?? "" });
  }
  return out;
}

/**
 * Split a markdown body into its heading sections. The first element is
 * always the preamble (possibly empty) so callers can tell "text before any
 * heading" apart from a section.
 *
 * A section ends at the NEXT HEADING OF ANY LEVEL — the same boundary the
 * app's log reader uses. `removeSection` uses the very same spans, which is
 * what keeps "parsed into rows" and "removed from the body" in step.
 */
export function splitSections(body: string): MarkdownSection[] {
  // Split on "\n" only, never on /\r?\n/: the lines are re-joined verbatim,
  // so a stripped "\r" would be a byte lost from the DM's text.
  const lines = body.split("\n");
  const headings = scanLines(lines);
  const sections: MarkdownSection[] = [{ lines: [], startIndex: -1, endIndex: 0 }];
  lines.forEach((line, index) => {
    const heading = headings[index];
    if (heading !== undefined) {
      sections[sections.length - 1]!.endIndex = index;
      sections.push({
        heading: heading.text,
        level: heading.level,
        headingLine: line,
        lines: [],
        startIndex: index,
        endIndex: index + 1,
      });
      return;
    }
    const current = sections[sections.length - 1]!;
    current.lines.push(line);
    current.endIndex = index + 1;
  });
  return sections;
}

function matchesSection(section: MarkdownSection, wanted: string, level?: number): boolean {
  if (section.heading === undefined) return false;
  if (level !== undefined && section.level !== level) return false;
  return section.heading.trim().toLowerCase() === wanted;
}

function isBlank(line: string | undefined): boolean {
  return line !== undefined && line.trim() === "";
}

/**
 * The body with one named section REMOVED (heading line included) — used
 * where a section becomes rows and must not also survive as prose.
 *
 * Three promises, all of them content-safety rules:
 *
 *   1. EXACTLY the span the parser read is removed — up to the next heading of
 *      any level. A `### Nachtrag` under `## Log` was never parsed into rows,
 *      so it STAYS in the body instead of disappearing with the section.
 *   2. Only the FIRST matching section goes. A body with two `## Log`
 *      headings has only its first one in the rows; removing the second too
 *      would delete lines nobody stored.
 *   3. Everything else stays BYTE-IDENTICAL. Only the seam of the cut is
 *      smoothed (one blank line, not two); the rest of the body — including
 *      the DM's own triple blank lines — is untouched.
 *
 * Matching is case-insensitive and ignores surrounding whitespace. `level`
 * pins the heading depth (`## Log` is level 2, as in the app). A missing
 * section returns the body completely unchanged.
 */
export function removeSection(body: string, heading: string, level?: number): string {
  const wanted = heading.trim().toLowerCase();
  const lines = body.split("\n");
  const target = splitSections(body).find((s) => matchesSection(s, wanted, level));
  if (target === undefined) return body;
  const before = lines.slice(0, target.startIndex);
  const after = lines.slice(target.endIndex);
  // The cut usually leaves a blank line on both sides; keep one.
  while (before.length > 0 && isBlank(before[before.length - 1]) && isBlank(after[0])) {
    after.shift();
  }
  const joined = [...before, ...after].join("\n");
  // Never hand back a body that is nothing but whitespace.
  return joined.trim() === "" ? "" : joined;
}

/**
 * The lines of one named section, or undefined when the section is absent.
 * `level` pins the heading depth; the first match wins.
 */
export function sectionLines(
  body: string,
  heading: string,
  level?: number,
): string[] | undefined {
  const wanted = heading.trim().toLowerCase();
  const target = splitSections(body).find((s) => matchesSection(s, wanted, level));
  return target?.lines;
}

/** The heading level `## Log` lives on — as in the app. */
export const SECTION_LEVEL = 2;

// --- structural vs. foreign lines --------------------------------------------

/**
 * True for a line that is part of a body's SKELETON rather than its content:
 * blank lines and headings. Those carry no information a row could lose.
 */
export function isStructuralLine(line: string): boolean {
  return line.trim() === "" || HEADING.test(line);
}

// --- glossary -----------------------------------------------------------------

/**
 * A glossary term line. Three spellings are accepted, because all three are
 * in the wild:
 *
 *   `- lighthouse keeper → Leuchtturmwärter`   (the `EN → DE` form the
 *                                               generator prompt texts)
 *   `- lighthouse keeper -> Leuchtturmwärter`   (ASCII arrow)
 *   `- Begriff: Erklärung`                      (colon form)
 *
 * The right-hand side must be NON-EMPTY: `- Regelbegriffe … bleiben
 * Englisch:` is a sentence that happens to end in a colon, not a term whose
 * explanation is missing, and turning it into a row would be a lie.
 */
const GLOSSARY_ARROW = /^[-*+]\s+(.+?)\s*(?:→|->|—>|=>)\s*(.+?)\s*$/;
const GLOSSARY_COLON = /^[-*+]\s+([^:]+?)\s*:\s+(.+?)\s*$/;
/**
 * A `**Begriff**` term line. Deliberately narrow, because the wide version of
 * this rule turned ordinary emphasis into invented terms: `**Wichtig:** Der
 * Wärter lügt.` is a sentence in a section's prose, not a glossary entry.
 *
 * Accepted are only the two shapes that ARE a term line:
 *
 *   `**Begriff**`                 the whole line is the bold term (the
 *                                 explanation follows on the next lines)
 *   `**Begriff**: Erklärung`      a separator directly after the bold, then
 *   `**Begriff** — Erklärung`     the explanation
 *
 * Anything else — bold followed by more prose without a separator, bold that
 * is not at the start of the line, a bold term that itself ends in a colon —
 * falls through and becomes part of the section's own explanation. Losing a
 * term to prose is recoverable by reading; inventing one is not.
 */
const GLOSSARY_BOLD = /^\*\*([^*]+?)\*\*(?:[ \t]*[:—–-][ \t]*(.*?))?[ \t]*$/;

export interface ParsedGlossaryEntry {
  term: string;
  explanation: string;
  pos: number;
}

export interface GlossaryParseResult {
  entries: ParsedGlossaryEntry[];
  /** Reasons the text did not decompose cleanly — one per incident. */
  problems: string[];
  /**
   * The prose ABOVE the first heading, which belongs to no term (rule 3
   * below). It is reported, and it is also handed back here verbatim so a
   * caller can KEEP it: the write path stores it in `campaigns.glossary_intro`
   * and the renderer puts it back in front of the term list. Without that a
   * save of the rendered glossary would delete it.
   */
  preamble: string;
  /**
   * Terms that appeared more than once. The first entry wins (see rule 4),
   * so the later explanation is not in `entries` — the WRITE path refuses the
   * save (400) instead of dropping what the DM just typed.
   */
  duplicates: string[];
}

/**
 * Turn a glossary body into term/explanation rows.
 *
 * The rules, in the order they fire per heading section:
 *
 *   1. Every term line (arrow, colon or `**bold**` form) becomes a row.
 *      Text following a `**bold**` term, up to the next term or heading, is
 *      appended to ITS explanation.
 *   2. Whatever text is left over in a section becomes the explanation of a
 *      row named after the section's HEADING. This is the
 *      "`## Begriff` mit Folgetext" rule, and it is what keeps a glossary's
 *      prose sections (`## Stil`, and its own `# …` title block) as visible
 *      content instead of a report entry.
 *   3. Leftover text with NO heading above it — prose before the first
 *      heading — is the one genuinely unassignable case and is reported.
 *   4. A duplicate term: the FIRST one wins, the second is reported.
 */
export function parseGlossaryBody(body: string): GlossaryParseResult {
  const result: GlossaryParseResult = {
    entries: [],
    problems: [],
    preamble: "",
    duplicates: [],
  };
  const byTerm = new Map<string, ParsedGlossaryEntry>();

  const add = (term: string, explanation: string): void => {
    const key = term.trim();
    if (key === "") return;
    const existing = byTerm.get(key);
    if (existing !== undefined) {
      result.duplicates.push(key);
      result.problems.push(
        `Glossar-Begriff „${key}" kommt mehrfach vor — der erste Eintrag gewinnt, ` +
          `die Erklärung „${explanation.trim()}" wurde nicht übernommen.`,
      );
      return;
    }
    const entry: ParsedGlossaryEntry = {
      term: key,
      explanation: explanation.trim(),
      pos: result.entries.length,
    };
    byTerm.set(key, entry);
    result.entries.push(entry);
  };

  for (const section of splitSections(body)) {
    const leftover: string[] = [];
    // The `**bold**` term the following prose belongs to, if any.
    let boldTerm: { term: string; lines: string[] } | undefined;
    const flushBold = (): void => {
      if (boldTerm === undefined) return;
      add(boldTerm.term, boldTerm.lines.join("\n"));
      boldTerm = undefined;
    };

    for (const rawLine of section.lines) {
      const line = rawLine.trim();
      if (line === "") {
        if (boldTerm !== undefined) boldTerm.lines.push("");
        else leftover.push(rawLine);
        continue;
      }
      const bold = GLOSSARY_BOLD.exec(line);
      // A bold "term" that ends in a colon is emphasis inside a sentence
      // (`**Wichtig:**`), never a term the DM looks up.
      if (bold !== null && !(bold[1] ?? "").trim().endsWith(":")) {
        flushBold();
        boldTerm = { term: bold[1] ?? "", lines: [(bold[2] ?? "").trim()] };
        continue;
      }
      const arrow = GLOSSARY_ARROW.exec(line);
      const colon = arrow === null ? GLOSSARY_COLON.exec(line) : null;
      const term = arrow ?? colon;
      if (term !== null) {
        flushBold();
        add(term[1] ?? "", term[2] ?? "");
        continue;
      }
      if (boldTerm !== undefined) boldTerm.lines.push(line);
      else leftover.push(rawLine);
    }
    flushBold();

    const rest = leftover.join("\n").trim();
    if (rest === "") continue;
    if (section.heading === undefined) {
      // Kept verbatim (see `preamble`) — reported, never dropped.
      result.preamble = rest;
      result.problems.push(
        "Glossar-Text vor der ersten Überschrift konnte keinem Begriff zugeordnet werden: " +
          `„${rest.split(/\r?\n/)[0] ?? ""}…"`,
      );
      continue;
    }
    add(section.heading, rest);
  }

  return result;
}
