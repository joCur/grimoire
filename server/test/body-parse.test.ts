// The body-parsing rules of the store, unit level: how a markdown text comes
// apart into sections, and how a glossary body becomes term rows.
//
// These are the DEGRADE RULES, which is why they are pinned here — they
// decide what an odd hand-written text turns into when `PUT /entry` saves the
// glossary back.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  isStructuralLine,
  logLineShortHash,
  parseGlossaryBody,
  removeSection,
  sectionLines,
  splitSections,
} from "../src/store/body-parse";

describe("splitSections / removeSection", () => {
  test("the text before the first heading is its own, headless section", () => {
    const sections = splitSections("Vorwort\n\n## Eins\na\n");
    expect(sections[0]?.heading).toBeUndefined();
    expect(sections[0]?.lines.join("\n").trim()).toBe("Vorwort");
    expect(sections[1]?.heading).toBe("Eins");
    expect(sections[1]?.level).toBe(2);
  });

  test("removeSection takes the heading and everything under it", () => {
    const body = "## A\n\neins\n\n## B\n\nzwei\n";
    expect(removeSection(body, "A")).toBe("## B\n\nzwei\n");
    expect(removeSection(body, "B").trim()).toBe("## A\n\neins");
  });

  test("a `###` subsection is NOT parsed, so it is NOT removed either", () => {
    // What this pins: `sectionLines` stops at the next heading of ANY level,
    // so the `### Nachtrag` lines are not part of the section. Removing them
    // with it would delete content nothing had read.
    const body = "## Log\n\n- 19:00 x\n\n### Nachtrag\n\ny\n\n## Threads\n\n- [ ] t\n";
    expect(sectionLines(body, "Log", 2)?.join("\n").trim()).toBe("- 19:00 x");
    const rest = removeSection(body, "Log", 2);
    expect(rest).toContain("### Nachtrag");
    expect(rest).toContain("y");
    expect(rest).toContain("## Threads");
    expect(rest).not.toContain("19:00");
  });

  test("only the FIRST section of a name is removed — the second was never parsed", () => {
    const body = "## Log\n\n- 19:00 a\n\n## Log\n\n- 20:00 b\n";
    // Only the first section is the one that was read …
    expect(sectionLines(body, "Log", 2)?.join("\n").trim()).toBe("- 19:00 a");
    // … so only the first one may go.
    const rest = removeSection(body, "Log", 2);
    expect(rest).toContain("## Log");
    expect(rest).toContain("- 20:00 b");
    expect(rest).not.toContain("19:00");
  });

  test("only the SEAM is smoothed — the rest of the body stays byte-identical", () => {
    const body = "Vorspann\n\n\n\nmit Absatz\n\n## Log\n\n- 19:00 a\n\n## Threads\n\n\nt\n";
    const rest = removeSection(body, "Log", 2);
    // The DM's own multiple blank lines survive verbatim …
    expect(rest).toBe("Vorspann\n\n\n\nmit Absatz\n\n## Threads\n\n\nt\n");
  });

  test("a missing section leaves the body byte-identical", () => {
    expect(removeSection("nur Text\n", "Log")).toBe("nur Text\n");
    expect(sectionLines("nur Text\n", "Log")).toBeUndefined();
    // Not even a body with odd whitespace is normalized when nothing matches.
    const odd = "a\n\n\n\nb\n\n";
    expect(removeSection(odd, "Log")).toBe(odd);
  });

  test("matching ignores case and surrounding whitespace", () => {
    expect(removeSection("##   log  \n\nx\n", "Log").trim()).toBe("");
  });

  test("a level restriction distinguishes `## Log` from `### Log`", () => {
    const body = "## Notizen\n\n### Log\n\n- 19:00 a\n";
    // The app reads `## Log` only (`/^##\s*Log\s*$/i`), so neither does this.
    expect(removeSection(body, "Log", 2)).toBe(body);
    expect(sectionLines(body, "Log", 2)).toBeUndefined();
    expect(sectionLines(body, "Log")).toEqual(["", "- 19:00 a", ""]);
  });

  test("a CRLF body keeps its carriage returns", () => {
    const body = "## Log\r\n\r\n- 19:00 a\r\n\r\n## Threads\r\n\r\n- [ ] t\r\n";
    expect(removeSection(body, "Log", 2)).toBe("## Threads\r\n\r\n- [ ] t\r\n");
  });
});

describe("heading recognition mirrors the app", () => {
  test("a hashtag line is not a heading — it needs a space", () => {
    // `#pause` is a hashtag the format puts on its own line (README).
    const body = "## Log\n\n- 19:00 a\n#pause\n- 20:00 b\n";
    expect(splitSections(body)).toHaveLength(2); // preamble + `## Log`
    expect(isStructuralLine("#pause")).toBe(false);
    expect(isStructuralLine("## Log")).toBe(true);
    expect(isStructuralLine("##")).toBe(true);
  });

  test("an indented `#` line is code, not a section boundary", () => {
    const body = "## Log\n\n- 19:00 a\n    ## nicht wirklich\n";
    expect(splitSections(body)).toHaveLength(2);
  });

  test("a `#` line inside a code fence is not a section boundary", () => {
    const body = "## Log\n\n- 19:00 a\n\n```sh\n# ein Kommentar\n```\n\n- 20:00 b\n";
    // The fenced `#` must not cut the section in half.
    expect(sectionLines(body, "Log", 2)?.join("\n")).toContain("- 20:00 b");
    expect(splitSections(body)).toHaveLength(2);
  });

  test("a seven-`#` line is not a heading", () => {
    expect(splitSections("####### zu tief\n")).toHaveLength(1);
  });
});

describe("logLineShortHash", () => {
  test("the hash is the one the review wrote — over the line as stored", () => {
    const line = "- 19:52 (arrival) Spuren gefunden";
    const expected = createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
    expect(logLineShortHash(line)).toBe(expected);
  });
});

describe("parseGlossaryBody", () => {
  test("all three term spellings become rows", () => {
    const result = parseGlossaryBody(
      "# Glossar\n\n- lighthouse keeper → Leuchtturmwärter\n- cove -> Bucht\n- Begriff: Erklärung\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.entries.map((e) => [e.term, e.explanation])).toEqual([
      ["lighthouse keeper", "Leuchtturmwärter"],
      ["cove", "Bucht"],
      ["Begriff", "Erklärung"],
    ]);
  });

  test("a sentence that merely ends in a colon is not a term", () => {
    // The exact shape of the example glossary's `## Stil` section — turning it
    // into a term with an empty explanation would be a lie about the content.
    const result = parseGlossaryBody(
      "## Stil\n\n- Regelbegriffe bleiben Englisch:\n  „advantage/disadvantage\".\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.term).toBe("Stil");
    expect(result.entries[0]?.explanation).toContain("Regelbegriffe bleiben Englisch:");
  });

  test("a heading with prose under it becomes one row named after the heading", () => {
    const result = parseGlossaryBody("## Ton\n\nbodenständig, keine hohe Magie\n");
    expect(result.entries).toEqual([
      { term: "Ton", explanation: "bodenständig, keine hohe Magie", pos: 0 },
    ]);
  });

  test("a `**Begriff**` block collects the text that follows it", () => {
    const result = parseGlossaryBody("# G\n\n**Vorlesetext**\n\nWas der DM laut liest.\n");
    expect(result.entries.map((e) => e.term)).toEqual(["Vorlesetext"]);
    expect(result.entries[0]?.explanation).toBe("Was der DM laut liest.");
  });

  test("a `**Begriff**: Erklärung` line is a term, on one line", () => {
    const result = parseGlossaryBody("# G\n\n**Kutter**: kleines Segelschiff\n");
    expect(result.entries).toEqual([
      { term: "Kutter", explanation: "kleines Segelschiff", pos: 0 },
    ]);
  });

  test("emphasis inside prose is NOT a term", () => {
    // The bug this pins: `**Wichtig:** …` matched the bold rule and became a
    // glossary term named "Wichtig:" — an entry the DM never wrote. Prose
    // belongs to its section's explanation.
    const result = parseGlossaryBody(
      "## Ton\n\n**Wichtig:** Der Wärter lügt.\n**Nie** Hochmagie.\nEin **Kutter** ist klein.\n",
    );
    expect(result.entries.map((e) => e.term)).toEqual(["Ton"]);
    const explanation = result.entries[0]?.explanation ?? "";
    expect(explanation).toContain("**Wichtig:** Der Wärter lügt.");
    expect(explanation).toContain("**Nie** Hochmagie.");
    expect(explanation).toContain("Ein **Kutter** ist klein.");
    expect(result.problems).toEqual([]);
  });

  test("the first of two identical terms wins, the second is reported", () => {
    const result = parseGlossaryBody("# G\n\n- ship → Schiff\n- ship → Boot\n");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.explanation).toBe("Schiff");
    expect(result.problems.join(" ")).toContain("mehrfach");
  });

  test("prose before the first heading is the one unassignable case", () => {
    const result = parseGlossaryBody("Freitext ohne Überschrift\n\n# G\n\n- a → b\n");
    expect(result.entries.map((e) => e.term)).toEqual(["a"]);
    expect(result.problems.join(" ")).toContain("vor der ersten Überschrift");
    // …and it is handed back verbatim so the caller can keep it.
    expect(result.preamble).toBe("Freitext ohne Überschrift");
  });

  test("a duplicate term is named, so a save can refuse instead of dropping it", () => {
    const result = parseGlossaryBody("- a → eins\n- a → zwei\n");
    expect(result.entries.map((e) => e.explanation)).toEqual(["eins"]);
    expect(result.duplicates).toEqual(["a"]);
  });

  test("an empty glossary is empty, not broken", () => {
    const empty = { entries: [], problems: [], preamble: "", duplicates: [] };
    expect(parseGlossaryBody("")).toEqual(empty);
    expect(parseGlossaryBody("\n\n")).toEqual(empty);
  });
});
