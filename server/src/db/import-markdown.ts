// Decomposing markdown bodies into rows — the pure half of the one-time
// migration (issue #54). No filesystem, no database: everything here is a
// function from text to data, so the degrade rules are unit-testable.
//
// The same design rule as everywhere else applies (DECISIONS #1): NOTHING
// here throws, and nothing is silently dropped. A line the grammar does not
// recognise keeps its `raw` and travels on with its parsed fields empty; the
// caller decides whether that is worth a `migration_report` entry.
//
// The log and inbox parsers deliberately mirror app/src/lib/session.ts and
// app/src/lib/review.ts LINE FOR LINE, including the trimming. They have to:
// the review's `reviewed` hashes were computed over exactly those strings, so
// a parser that trimmed differently would orphan every hash in the campaign.

import { createHash } from "node:crypto";

/** Short hash of a raw log line — mirror of `logLineShortHash` (write API). */
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
}

const HEADING = /^(#{1,6})\s*(.*?)\s*$/;

/**
 * Split a markdown body into its top-level-and-deeper heading sections. The
 * first element is always the preamble (possibly empty) so callers can tell
 * "text before any heading" apart from a section.
 */
export function splitSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [{ lines: [] }];
  for (const line of body.split(/\r?\n/)) {
    const m = HEADING.exec(line.trim());
    if (m !== null && line.trim().startsWith("#")) {
      sections.push({
        heading: m[2] ?? "",
        level: (m[1] ?? "#").length,
        headingLine: line,
        lines: [],
      });
      continue;
    }
    sections[sections.length - 1]!.lines.push(line);
  }
  return sections;
}

/**
 * The body with one named section REMOVED (heading line included) — used
 * where a section becomes rows and must not also survive as prose: a
 * session's `## Log` (now `log_entries`) and an npc's `## Beziehungen` (now
 * `npc_relations`). Rendering puts them back from the rows.
 *
 * A section reaches to the next heading of the SAME OR SHALLOWER level, so a
 * `### ` subheading inside `## Log` goes with it. Matching is
 * case-insensitive and ignores surrounding whitespace; a missing section
 * returns the body unchanged.
 */
export function removeSection(body: string, heading: string): string {
  const wanted = heading.trim().toLowerCase();
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  let skipLevel = 0;
  for (const line of lines) {
    const m = HEADING.exec(line.trim());
    const isHeading = m !== null && line.trim().startsWith("#");
    if (isHeading) {
      const level = (m[1] ?? "#").length;
      const text = (m[2] ?? "").trim().toLowerCase();
      if (skipping && level <= skipLevel) skipping = false;
      if (!skipping && text === wanted) {
        skipping = true;
        skipLevel = level;
        continue;
      }
    }
    if (!skipping) out.push(line);
  }
  // Collapse the blank-line pair the removal usually leaves behind, and never
  // hand back a body that is nothing but whitespace.
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return joined.trim() === "" ? "" : joined;
}

/** The lines of one named section, or undefined when the section is absent. */
export function sectionLines(body: string, heading: string): string[] | undefined {
  const wanted = heading.trim().toLowerCase();
  for (const section of splitSections(body)) {
    if (section.heading !== undefined && section.heading.trim().toLowerCase() === wanted) {
      return section.lines;
    }
  }
  return undefined;
}

// --- structural vs. foreign lines --------------------------------------------

/**
 * True for a line that is part of the file's SKELETON rather than content:
 * blank lines and headings. Those are not "foreign lines" — they carry no
 * information a row could lose, so they never produce a report entry (they
 * are still kept verbatim in `raw` where a table has one).
 */
export function isStructuralLine(line: string): boolean {
  const t = line.trim();
  return t === "" || /^#{1,6}(\s|$)/.test(t);
}

// --- session log --------------------------------------------------------------

/** `- HH:MM (sceneId) text` — mirror of app/src/lib/session.ts LOG_LINE. */
const LOG_LINE = /^-\s+(\d{1,2}:\d{2})(?:\s+\(([^)]+)\))?\s+(.+)$/;

export interface ImportedLogEntry {
  pos: number;
  /** The line as the review hashes it: trimmed, exactly as in the app parser. */
  raw: string;
  at?: string;
  sceneId?: string;
  text?: string;
  hash: string;
  /** True when the line's shape was not recognised — `raw` is all there is. */
  foreign: boolean;
}

/**
 * The `## Log` section as rows. Blank lines are skipped and the next heading
 * ends the log, exactly as the app's live view reads it — anything else would
 * make the migration disagree with what the DM has been looking at.
 */
export function parseLogSection(body: string): ImportedLogEntry[] {
  const lines = sectionLines(body, "Log");
  if (lines === undefined) return [];
  const out: ImportedLogEntry[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") continue;
    const m = LOG_LINE.exec(line);
    const entry: ImportedLogEntry = {
      pos: out.length,
      raw: line,
      hash: logLineShortHash(line),
      foreign: m === null,
    };
    if (m !== null) {
      entry.at = m[1] ?? "";
      if (m[2] !== undefined) entry.sceneId = m[2];
      entry.text = m[3] ?? "";
    }
    out.push(entry);
  }
  return out;
}

// --- inbox -------------------------------------------------------------------

const CHECKBOX = /^\[([ xX])\]\s*/;

export interface ImportedInboxEntry {
  pos: number;
  /** The line verbatim (NOT trimmed) — the write API matched it byte for byte. */
  raw: string;
  text?: string;
  done: boolean;
  /** True for a non-blank, non-heading line that is not a list entry. */
  foreign: boolean;
}

/**
 * The inbox body as rows. Every non-blank line becomes a row so the file's
 * order and its prose survive; only `- ` lines get a parsed `text`, mirroring
 * app/src/lib/review.ts (which is what the write API accepts).
 *
 * Headings keep their place with `text` unset and `foreign: false` — `##
 * Eingang` is the skeleton the format prescribes, not a lost idea.
 */
export function parseInboxBody(body: string): ImportedInboxEntry[] {
  const out: ImportedInboxEntry[] = [];
  // Exact split, like the app: the raw line must match the file byte for byte.
  for (const raw of body.split("\n")) {
    if (raw.trim() === "") continue;
    if (!raw.startsWith("- ")) {
      out.push({ pos: out.length, raw, done: false, foreign: !isStructuralLine(raw) });
      continue;
    }
    let rest = raw.slice(2);
    let done = false;
    const marker = CHECKBOX.exec(rest);
    if (marker !== null) {
      done = (marker[1] ?? " ") !== " ";
      rest = rest.slice(marker[0].length);
    }
    out.push({ pos: out.length, raw, text: rest, done, foreign: false });
  }
  return out;
}

// --- npc relations ------------------------------------------------------------

/** `- <npc-id>: <Freitext>` (README, "Entität: NPC"). */
const RELATION_LINE = /^[-*+]\s+([^:]+?)\s*:\s*(.*)$/;

export interface ImportedRelation {
  otherNpcId: string;
  note: string;
  pos: number;
}

export interface RelationParseResult {
  relations: ImportedRelation[];
  /** Non-blank lines of the section that are not relation lines. */
  foreignLines: string[];
}

/**
 * The `## Beziehungen` section as rows. A line without a colon is not a
 * relation — it is reported and kept (the caller puts the file in
 * `unknown_files`), because guessing an npc id out of prose would invent a
 * reference that never existed.
 */
export function parseRelationsSection(body: string): RelationParseResult {
  const lines = sectionLines(body, "Beziehungen");
  const result: RelationParseResult = { relations: [], foreignLines: [] };
  if (lines === undefined) return result;
  const seen = new Set<string>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") continue;
    const m = RELATION_LINE.exec(line);
    if (m === null) {
      result.foreignLines.push(line);
      continue;
    }
    const otherNpcId = (m[1] ?? "").trim();
    if (otherNpcId === "" || seen.has(otherNpcId)) {
      // A duplicate counterpart cannot become a second row (composite PK) —
      // report it rather than lose it silently.
      result.foreignLines.push(line);
      continue;
    }
    seen.add(otherNpcId);
    result.relations.push({
      otherNpcId,
      note: (m[2] ?? "").trim(),
      pos: result.relations.length,
    });
  }
  return result;
}

// --- glossary -----------------------------------------------------------------

/**
 * A glossary term line. Three spellings are accepted, because all three are
 * in the wild:
 *
 *   `- lighthouse keeper → Leuchtturmwärter`   (examples/beispiel — the
 *                                               `EN → DE` form the generator
 *                                               prompt documents)
 *   `- lighthouse keeper -> Leuchtturmwärter`   (ASCII arrow)
 *   `- Begriff: Erklärung`                      (planning section 2)
 *
 * The right-hand side must be NON-EMPTY: `- Regelbegriffe … bleiben
 * Englisch:` is a sentence that happens to end in a colon, not a term whose
 * explanation is missing, and turning it into a row would be a lie.
 */
const GLOSSARY_ARROW = /^[-*+]\s+(.+?)\s*(?:→|->|—>|=>)\s*(.+?)\s*$/;
const GLOSSARY_COLON = /^[-*+]\s+([^:]+?)\s*:\s+(.+?)\s*$/;
/** `**Begriff**` (optionally followed by the explanation on the same line). */
const GLOSSARY_BOLD = /^\*\*(.+?)\*\*\s*[:—–-]?\s*(.*)$/;

export interface ImportedGlossaryEntry {
  term: string;
  explanation: string;
  pos: number;
}

export interface GlossaryParseResult {
  entries: ImportedGlossaryEntry[];
  /**
   * Reasons the file did not decompose cleanly — one per incident, ready for
   * `migration_report`. Non-empty means the caller ALSO keeps the file
   * verbatim in `unknown_files` (planning section 2).
   */
  problems: string[];
}

/**
 * Turn a glossary body into term/explanation rows (planning section 2, PO
 * decision F6).
 *
 * The rules, in the order they fire per heading section:
 *
 *   1. Every term line (arrow, colon or `**bold**` form) becomes a row.
 *      Text following a `**bold**` term, up to the next term or heading, is
 *      appended to ITS explanation.
 *   2. Whatever text is left over in a section becomes the explanation of a
 *      row named after the section's HEADING. This is the planning's
 *      "`## Begriff` mit Folgetext" rule, and it is what keeps a glossary's
 *      prose sections (`## Stil`, and the file's own `# …` title block)
 *      as visible content instead of a report entry.
 *   3. Leftover text with NO heading above it — prose before the first
 *      heading — is the one genuinely unassignable case and is reported.
 *   4. A duplicate term: the FIRST one wins, the second is reported
 *      (planning: "Duplikat-Begriff: erster gewinnt, zweiter in den Report").
 */
export function parseGlossaryBody(body: string): GlossaryParseResult {
  const result: GlossaryParseResult = { entries: [], problems: [] };
  const byTerm = new Map<string, ImportedGlossaryEntry>();

  const add = (term: string, explanation: string): void => {
    const key = term.trim();
    if (key === "") return;
    const existing = byTerm.get(key);
    if (existing !== undefined) {
      result.problems.push(
        `Glossar-Begriff „${key}" kommt mehrfach vor — der erste Eintrag gewinnt, ` +
          `die Erklärung „${explanation.trim()}" wurde nicht übernommen.`,
      );
      return;
    }
    const entry: ImportedGlossaryEntry = {
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
      if (bold !== null) {
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
