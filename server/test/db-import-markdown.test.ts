// The markdown decomposition rules of the one-time migration, unit level
// (issue #54). The integration side is test/db-migration.test.ts; this file
// pins the DEGRADE RULES themselves, because they are the part that decides
// whether a DM's odd hand-written file survives the move.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  logLineShortHash,
  parseGlossaryBody,
  parseInboxBody,
  parseLogSection,
  parseRelationsSection,
  removeSection,
  sectionLines,
  splitSections,
} from "../src/db/import-markdown";

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

  test("a subheading belongs to the section it sits in", () => {
    const body = "## Log\n\n- 19:00 x\n\n### Nachtrag\n\ny\n\n## Threads\n\n- [ ] t\n";
    const rest = removeSection(body, "Log");
    expect(rest).not.toContain("Nachtrag");
    expect(rest).toContain("## Threads");
  });

  test("a missing section leaves the body alone", () => {
    expect(removeSection("nur Text\n", "Log")).toBe("nur Text\n");
    expect(sectionLines("nur Text\n", "Log")).toBeUndefined();
  });

  test("matching ignores case and surrounding whitespace", () => {
    expect(removeSection("##   log  \n\nx\n", "Log").trim()).toBe("");
  });
});

describe("parseLogSection", () => {
  test("time, scene context and text come apart; order is the file order", () => {
    const entries = parseLogSection(
      "## Log\n\n- 19:52 (arrival) Spuren gefunden #decision\n- 20:30 — Pause\n",
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      pos: 0,
      at: "19:52",
      sceneId: "arrival",
      text: "Spuren gefunden #decision",
      foreign: false,
    });
    // A scene-less line keeps its time and has no scene context.
    expect(entries[1]?.sceneId).toBeUndefined();
    expect(entries[1]?.text).toBe("— Pause");
  });

  test("a line of another shape survives as raw and is flagged", () => {
    const entries = parseLogSection("## Log\n\nvon Hand getippt\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.raw).toBe("von Hand getippt");
    expect(entries[0]?.at).toBeUndefined();
    expect(entries[0]?.text).toBeUndefined();
    expect(entries[0]?.foreign).toBe(true);
  });

  test("the next heading ends the log and blank lines are skipped", () => {
    const entries = parseLogSection("## Log\n\n- 19:00 a\n\n## Threads\n\n- [ ] kein Log\n");
    expect(entries.map((e) => e.text)).toEqual(["a"]);
  });

  test("the hash is the one the review wrote — over the TRIMMED line", () => {
    const line = "- 19:52 (arrival) Spuren gefunden";
    const entries = parseLogSection(`## Log\n\n  ${line}  \n`);
    const expected = createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
    expect(entries[0]?.hash).toBe(expected);
    expect(logLineShortHash(line)).toBe(expected);
  });
});

describe("parseInboxBody", () => {
  test("list lines are parsed, checkboxes become the done flag", () => {
    const entries = parseInboxBody("## Eingang\n\n- eine Idee #thread\n- [x] erledigt\n- [ ] offen\n");
    expect(entries.map((e) => [e.text, e.done, e.foreign])).toEqual([
      [undefined, false, false], // the heading: structure, not a lost idea
      ["eine Idee #thread", false, false],
      ["erledigt", true, false],
      ["offen", false, false],
    ]);
  });

  test("`raw` is byte-exact — the write API matched on it", () => {
    const entries = parseInboxBody("-   viel Abstand\n");
    expect(entries[0]?.raw).toBe("-   viel Abstand");
    expect(entries[0]?.text).toBe("  viel Abstand");
  });

  test("prose that is neither heading nor list is kept and flagged", () => {
    const entries = parseInboxBody("Freitext mittendrin\n");
    expect(entries[0]?.raw).toBe("Freitext mittendrin");
    expect(entries[0]?.text).toBeUndefined();
    expect(entries[0]?.foreign).toBe(true);
  });
});

describe("parseRelationsSection", () => {
  test("`- <npc-id>: <Text>` becomes ordered rows", () => {
    const result = parseRelationsSection("## Beziehungen\n\n- fenn: alte Bekannte\n- jorna: misstraut ihr\n");
    expect(result.foreignLines).toEqual([]);
    expect(result.relations).toEqual([
      { otherNpcId: "fenn", note: "alte Bekannte", pos: 0 },
      { otherNpcId: "jorna", note: "misstraut ihr", pos: 1 },
    ]);
  });

  test("a colon-less line is reported, not guessed at", () => {
    const result = parseRelationsSection("## Beziehungen\n\n- irgendwer aus dem Dorf\n");
    expect(result.relations).toEqual([]);
    expect(result.foreignLines).toEqual(["- irgendwer aus dem Dorf"]);
  });

  test("a duplicate counterpart cannot become a second row", () => {
    const result = parseRelationsSection("## Beziehungen\n\n- fenn: eins\n- fenn: zwei\n");
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.note).toBe("eins");
    expect(result.foreignLines).toEqual(["- fenn: zwei"]);
  });

  test("no section at all is not a problem", () => {
    expect(parseRelationsSection("## Will\n\nx\n")).toEqual({ relations: [], foreignLines: [] });
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
    // The exact shape from examples/beispiel's `## Stil` section — turning it
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
  });

  test("an empty glossary is empty, not broken", () => {
    expect(parseGlossaryBody("")).toEqual({ entries: [], problems: [] });
    expect(parseGlossaryBody("\n\n")).toEqual({ entries: [], problems: [] });
  });
});
