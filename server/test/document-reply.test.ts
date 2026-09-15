// The raw document reply (issue #107).
//
// AK1 is the PO case of 15.09.: a scene whose body carries German quotation
// marks closed with an ASCII `"`. As a JSON string value that `"` ended the
// string and an inhaltlich correct scene cost the run a correction turn (and
// then a „Formprüfung nicht bestanden"). As a raw document it is just text.

import { describe, expect, test } from "bun:test";
import {
  NOT_A_DOCUMENT_ERROR,
  WARNINGS_DELIMITER,
  parseDocumentReply,
} from "../src/document-reply";

/** The document of the PO example, ASCII closing quote included. */
const PO_SCENE = `---
id: night-watch-quay
title: Nachtwache am Kai
type: planned
chapter: 01-salzhafen
status: draft
---

## Flow

Die Wache am Kran murrt: „Wer nachts hier steht, hat was zu verbergen."
Zwei Laternen wandern über die Mole.

> [!readaloud] „Bleibt, wo ihr seid", ruft jemand aus dem Dunkeln — und die
> Stimme klingt jünger, als sie sein sollte.

> [!check] Dexterity (Stealth) DC 13, um unter die Mole zu kommen.
`;

/** What the parser gave back, or the test fails with the error message. */
function parse(raw: string): { content: string; warnings: string[] } {
  const outcome = parseDocumentReply(raw);
  if (!outcome.ok) throw new Error(`expected a document, got: ${outcome.error}`);
  return outcome.reply;
}

/** The error message, or the test fails because it parsed after all. */
function error(raw: string): string {
  const outcome = parseDocumentReply(raw);
  if (outcome.ok) throw new Error("expected an error, got a document");
  return outcome.error;
}

describe("parseDocumentReply", () => {
  test("AK1: the PO scene with an ASCII closing quote parses unchanged", () => {
    const reply = parse(PO_SCENE);
    expect(reply.content).toBe(PO_SCENE);
    expect(reply.warnings).toEqual([]);
    // The quotation marks survive byte for byte — the server corrects nothing.
    expect(reply.content).toContain('„Wer nachts hier steht, hat was zu verbergen."');
  });

  test("the warnings block is split off, one warning per line", () => {
    const reply = parse(
      `${PO_SCENE}\n${WARNINGS_DELIMITER}\nDer Quelltext nennt keinen DC — DC 13 gesetzt.\nDie Wache hat keinen Namen.\n`,
    );
    expect(reply.content).toBe(PO_SCENE);
    expect(reply.warnings).toEqual([
      "Der Quelltext nennt keinen DC — DC 13 gesetzt.",
      "Die Wache hat keinen Namen.",
    ]);
  });

  test("a warnings block that is bulleted, padded or empty still reads right", () => {
    expect(parse(`${PO_SCENE}\n${WARNINGS_DELIMITER}\n\n- eins\n* zwei\n\n`).warnings).toEqual([
      "eins",
      "zwei",
    ]);
    // An EMPTY block is no warnings, not one empty warning.
    expect(parse(`${PO_SCENE}\n${WARNINGS_DELIMITER}\n`).warnings).toEqual([]);
    // A model that got the word right and the dashes wrong still said it.
    expect(parse(`${PO_SCENE}\n--Warnings--\ndrei\n`).warnings).toEqual(["drei"]);
  });

  test("a surrounding fence and a leading sentence come off (both cost nothing)", () => {
    const reply = parse(
      [
        "Hier ist die Szene — ich habe den DC gesetzt:",
        "",
        "```markdown",
        PO_SCENE.trimEnd(),
        "```",
        "",
        WARNINGS_DELIMITER,
        "DC gesetzt.",
      ].join("\n"),
    );
    expect(reply.content).toBe(PO_SCENE);
    expect(reply.warnings).toEqual(["DC gesetzt."]);
  });

  test("a fence INSIDE the document does not cut it short", () => {
    const withFence = `${PO_SCENE.trimEnd()}\n\n> [!note] Beispiel:\n\n\`\`\`\nein Block\n\`\`\`\n`;
    expect(parse("```\n" + withFence + "```\n").content).toBe(withFence);
    // …and without an outer fence the inner one is simply body text.
    expect(parse(withFence).content).toBe(withFence);
  });

  test("trailing whitespace is normalized to exactly one newline", () => {
    expect(parse(`${PO_SCENE}\n\n\n`).content).toBe(PO_SCENE);
    expect(parse(PO_SCENE.trimEnd()).content).toBe(PO_SCENE);
    // CRLF from a Windows-ish endpoint reads the same.
    expect(parse(PO_SCENE.replace(/\n/g, "\r\n")).content).toBe(PO_SCENE);
  });

  test("no frontmatter start is the ONE error, and it says what a document is", () => {
    for (const raw of [
      "",
      "   \n  ",
      "Ich kann diese Aufgabe leider nicht erfüllen.",
      // The old JSON wrapper: valid JSON, not a document.
      JSON.stringify({ scene: { content: PO_SCENE }, warnings: [] }),
      // A single `---` opens nothing.
      "---\nid: night-watch-quay\n\n## Flow\n\nText.\n",
      // …and a warnings block alone is not a document either.
      `${WARNINGS_DELIMITER}\nnur eine Warnung\n`,
    ]) {
      expect(error(raw)).toBe(NOT_A_DOCUMENT_ERROR);
    }
    // The message names the delimiter, so the model can fix the one thing.
    expect(NOT_A_DOCUMENT_ERROR).toContain(WARNINGS_DELIMITER);
    expect(NOT_A_DOCUMENT_ERROR).toContain("Frontmatter-Block");
  });

  test("trailing model chatter after an unfenced document comes off", () => {
    const reply = parse(`${PO_SCENE}\nIch hoffe, das passt so!\n`);
    expect(reply.content).toBe(PO_SCENE);
    expect(reply.content).not.toContain("Ich hoffe");
  });

  test("a closing paragraph WITH structure stays — only structureless chatter goes", () => {
    for (const closing of [
      "> [!note] Die Wache erinnert sich.",
      "- Die Wache erinnert sich.",
      "Die Wache erinnert sich an [[night-watch-quay]].",
      "| Wurf | Folge |\n| --- | --- |",
      "Nutze `Stealth` erneut.",
    ]) {
      const reply = parse(`${PO_SCENE}\n${closing}\n`);
      expect(reply.content).toBe(`${PO_SCENE}\n${closing}\n`);
    }
    // A structureless block under a bare HEADING is that section's text —
    // `## Will` plus one sentence is how an npc stub ends.
    const section = `${PO_SCENE}\n## Nachwirkung\n\nDie Wache erinnert sich.\n`;
    expect(parse(section).content).toBe(section);
    // The price of the rule: a plain closing paragraph that does NOT sit
    // under a heading cannot be told apart from a sign-off and is cut.
    expect(parse(`${PO_SCENE}\nEin schlichter Schlussabsatz.\n`).content).toBe(PO_SCENE);
    // A FENCED reply is left alone: the fence already said where it ends.
    const fenced = `\`\`\`markdown\n${PO_SCENE}\nIch hoffe, das passt so!\n\`\`\`\n`;
    expect(parse(fenced).content).toContain("Ich hoffe, das passt so!");
  });

  test("the frontmatter opener must be the FIRST `---` of the block", () => {
    // A leading sentence is still dropped…
    expect(parse(`Hier ist die Szene:\n\n${PO_SCENE}`).content).toBe(PO_SCENE);
    // …but prose with a horizontal rule in it is prose, not a document.
    expect(error(`Erst ein Absatz.\n\n---\n\n${PO_SCENE}`)).toBe(NOT_A_DOCUMENT_ERROR);
  });

  test("two horizontal rules are not a frontmatter block", () => {
    expect(error("Ein Absatz.\n\n---\n\nNoch ein Absatz.\n\n---\n\nUnd Schluss.\n")).toBe(
      NOT_A_DOCUMENT_ERROR,
    );
  });

  test("a `---warnings---` inside a fenced body block is example text", () => {
    const withExample = `${PO_SCENE.trimEnd()}\n\n> [!note] So sieht das aus:\n\n\`\`\`\n${WARNINGS_DELIMITER}\nnur ein Beispiel\n\`\`\`\n`;
    const reply = parse(withExample);
    expect(reply.warnings).toEqual([]);
    expect(reply.content).toBe(withExample);
    // The REAL block, below the fenced example, still wins.
    const both = parse(`${withExample}\n${WARNINGS_DELIMITER}\nechte Warnung\n`);
    expect(both.warnings).toEqual(["echte Warnung"]);
    expect(both.content).toBe(withExample);
  });

  test("a leading BOM does not hide the frontmatter", () => {
    expect(parse(`\uFEFF${PO_SCENE}`).content).toBe(PO_SCENE);
  });

  test("numbered and `+` warnings lose their marker too", () => {
    expect(
      parse(`${PO_SCENE}\n${WARNINGS_DELIMITER}\n1. eins\n2) zwei\n+ drei\n`).warnings,
    ).toEqual(["eins", "zwei", "drei"]);
  });

  test("the delimiter is read from the END — a mention in the body is body", () => {
    // The LAST occurrence wins, so a document that TALKS about the delimiter
    // keeps its own text and only the real block becomes warnings.
    const reply = parse(
      `${PO_SCENE.trimEnd()}\n\n> [!note] Schreibe Warnungen nach ---warnings---.\n\n${WARNINGS_DELIMITER}\nletzte Warnung\n`,
    );
    expect(reply.warnings).toEqual(["letzte Warnung"]);
    expect(reply.content).toContain("Schreibe Warnungen nach");
  });
});
