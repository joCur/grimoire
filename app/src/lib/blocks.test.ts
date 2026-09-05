// The heart of the Block-Composer's phase 1 (issue #43): the round-trip.
//
// A composer that rewrites a hand-edited file on open is worse than no
// composer, so the central test is not a unit test at all — it reads EVERY
// markdown file in examples/, strips the frontmatter exactly the way the app
// receives it (ParsedFile.body via @grimoire/shared) and demands
// `serializeBlocks(parseBlocks(body)) === body`, byte for byte. Blank-line
// runs, `>` styles, wrapping, the trailing newline: nothing may move.

import { parseMarkdown } from "@grimoire/shared";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  blockLabel,
  blockMarkdown,
  blockText,
  calloutLabel,
  endsIfSectionText,
  insertBlock,
  makeCallout,
  makeHeading,
  makeIfSection,
  makeText,
  moveBlock,
  parseBlocks,
  removeBlock,
  serializeBlocks,
  withBlockText,
  withChildren,
  withIfCondition,
  type SceneBlock,
} from "./blocks";

const EXAMPLES = new URL("../../../examples/", import.meta.url);

/** Every .md file under examples/, campaign-relative, sorted. */
function exampleFiles(): string[] {
  return readdirSync(EXAMPLES, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.replace(/\\/g, "/"))
    .sort();
}

/** The body as the app sees it: whatever GET /file put into ParsedFile.body. */
function exampleBody(rel: string): string {
  const raw = readFileSync(new URL(rel, EXAMPLES), "utf8");
  return parseMarkdown(raw, rel, 0).body;
}

/** The block types in order, sections as `ifSection(…children…)`. */
function shape(blocks: SceneBlock[]): string[] {
  return blocks.map((block) =>
    block.type === "ifSection"
      ? `ifSection(${shape(block.children).join(",")})`
      : block.type === "callout"
        ? `callout:${block.kind}`
        : block.type,
  );
}

describe("roundtrip over examples/", () => {
  const files = exampleFiles();

  test("finds the example campaign", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md");
  });

  for (const rel of files) {
    test(`${rel} is byte-identical after a roundtrip`, () => {
      const body = exampleBody(rel);
      expect(serializeBlocks(parseBlocks(body))).toBe(body);
    });
  }

  test("every example produces at least one block", () => {
    for (const rel of files) {
      expect(parseBlocks(exampleBody(rel)).length).toBeGreaterThan(0);
    }
  });
});

describe("structure of the reference scenes", () => {
  test("ankunft-leuchtturm: Flow plus the four callouts", () => {
    const blocks = parseBlocks(exampleBody("beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md"));
    expect(shape(blocks)).toEqual([
      "heading",
      "text",
      "callout:readaloud",
      "callout:check",
      "callout:secret",
      "callout:note",
    ]);

    const heading = blocks[0];
    if (heading?.type !== "heading") throw new Error("expected a heading");
    expect(heading.depth).toBe(2);
    expect(heading.text).toBe("Flow");
    // gray-matter hands over the blank line after the frontmatter fence.
    expect(heading.lead).toBe("\n");

    const readaloud = blocks[2];
    if (readaloud?.type !== "callout") throw new Error("expected a callout");
    expect(readaloud.kind).toBe("readaloud");
    expect(readaloud.text.startsWith("Der Turm ragt schwarz")).toBe(true);
    // The `>` markers are gone, the hand-wrapped soft breaks are not.
    expect(readaloud.text).not.toContain(">");
    expect(readaloud.text.split("\n")).toHaveLength(4);
  });

  test("von-schmugglern-erwischt: two If-sections with their children", () => {
    const blocks = parseBlocks(
      exampleBody("beispiel/01-salzhafen/hafen/von-schmugglern-erwischt.md"),
    );
    expect(shape(blocks)).toEqual([
      "heading",
      "text",
      "ifSection(text,text,callout:note)",
      "ifSection(callout:check,text,callout:outcome)",
    ]);

    const first = blocks[2];
    if (first?.type !== "ifSection") throw new Error("expected an If-section");
    expect(first.condition).toBe("sie geben zu, für Jorna zu arbeiten");
    // The section's own source is the heading LINE — the children keep theirs.
    expect(first.source).toBe("## If: sie geben zu, für Jorna zu arbeiten");

    // The tight option list stays ONE block, not three.
    const list = first.children[1];
    if (list?.type !== "text") throw new Error("expected a text block");
    expect(list.text.split("\n")).toHaveLength(3);
    expect(list.text.startsWith("- die morschen Bretter")).toBe(true);

    const second = blocks[3];
    if (second?.type !== "ifSection") throw new Error("expected an If-section");
    expect(second.condition).toBe("sie lügen (Schiffbrüchige, verirrte Reisende ...)");
  });

  test("a heading of depth <= 2 ends an If-section", () => {
    const body = "## If: a\n\ndrin\n\n## Flow\n\ndraußen\n";
    expect(shape(parseBlocks(body))).toEqual(["ifSection(text)", "heading", "text"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });

  test("a deeper heading stays inside the If-section", () => {
    const body = "## If: a\n\n### Detail\n\ndrin\n";
    expect(shape(parseBlocks(body))).toEqual(["ifSection(heading,text)"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });
});

describe("editing a block", () => {
  const rel = "beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md";

  test("only the edited callout changes, every sibling byte-identical", () => {
    const body = exampleBody(rel);
    const blocks = parseBlocks(body);
    const original = blocks[2];
    if (original?.type !== "callout") throw new Error("expected the readaloud callout");
    const before = original.source;
    if (before === undefined) throw new Error("parsed blocks carry their source");

    const edited = withBlockText(original, "Der Turm steht still. Kein Licht.");
    expect(edited.source).toBeUndefined();
    expect(edited.gap).toBe(original.gap); // a separator is not content

    const next = serializeBlocks(blocks.map((b) => (b === original ? edited : b)));
    expect(next).toBe(
      body.replace(before, "> [!readaloud] Der Turm steht still. Kein Licht."),
    );
    // Nothing else moved: cutting the changed region out leaves the rest equal.
    expect(next.split("> [!readaloud]")[0]).toBe(body.split("> [!readaloud]")[0]);
  });

  test("an edited multi-paragraph callout renders bare `>` for blank lines", () => {
    const blocks = parseBlocks("> [!note] alt\n");
    const note = blocks[0];
    if (note?.type !== "callout") throw new Error("expected a callout");
    expect(serializeBlocks([withBlockText(note, "eins\n\nzwei")])).toBe(
      "> [!note] eins\n>\n> zwei\n",
    );
  });

  test("editing an If-condition keeps the children verbatim", () => {
    const body = "## If: alt\n\n> [!note]  seltsam    umbrochen\n> weiter\n";
    const blocks = parseBlocks(body);
    const section = blocks[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    const next = serializeBlocks([withIfCondition(section, "neu")]);
    expect(next).toBe("## If: neu\n\n> [!note]  seltsam    umbrochen\n> weiter\n");
  });

  test("editing a child of a section is not swallowed by the section", () => {
    const body = "## If: a\n\n> [!check] alt\n";
    const blocks = parseBlocks(body);
    const section = blocks[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    const child = section.children[0];
    if (child?.type !== "callout") throw new Error("expected a callout child");
    const next = serializeBlocks([withChildren(section, [withBlockText(child, "neu")])]);
    expect(next).toBe("## If: a\n\n> [!check] neu\n");
  });
});

describe("constructors", () => {
  test("a new callout parses back into the same block", () => {
    const block = makeCallout("readaloud", "Der Turm steht still.");
    const markdown = serializeBlocks([block]);
    expect(markdown).toBe("> [!readaloud] Der Turm steht still.\n");
    const reparsed = parseBlocks(markdown)[0];
    if (reparsed?.type !== "callout") throw new Error("expected a callout");
    expect(reparsed.kind).toBe("readaloud");
    expect(reparsed.text).toBe(block.text);
    expect(serializeBlocks([reparsed])).toBe(markdown);
  });

  test("every callout kind is a fixpoint, single-paragraph and multi", () => {
    for (const kind of ["readaloud", "check", "secret", "outcome", "loot", "note"] as const) {
      for (const text of ["kurz", "eins\n\nzwei", "eine Zeile\nnoch eine"]) {
        const markdown = serializeBlocks([makeCallout(kind, text)]);
        const reparsed = parseBlocks(markdown)[0];
        if (reparsed?.type !== "callout") throw new Error(`not a callout: ${markdown}`);
        expect(reparsed.kind).toBe(kind);
        expect(reparsed.text).toBe(text);
        expect(serializeBlocks(parseBlocks(markdown))).toBe(markdown);
      }
    }
  });

  test("an If-section with children is a fixpoint", () => {
    const section = makeIfSection("sie lügen", [
      makeCallout("check", "Charisma (Deception) vs. Wisdom (Insight)."),
      makeText("- geglaubt\n- nicht geglaubt"),
    ]);
    const markdown = serializeBlocks([section]);
    expect(markdown).toBe(
      "## If: sie lügen\n\n> [!check] Charisma (Deception) vs. Wisdom (Insight).\n\n- geglaubt\n- nicht geglaubt\n",
    );
    expect(shape(parseBlocks(markdown))).toEqual(["ifSection(callout:check,text)"]);
    expect(serializeBlocks(parseBlocks(markdown))).toBe(markdown);
  });

  test("headings and text blocks are fixpoints", () => {
    const blocks = [makeHeading(2, "Flow"), makeText("Ein Absatz.\nZweite Zeile.")];
    const markdown = serializeBlocks(blocks);
    expect(markdown).toBe("## Flow\n\nEin Absatz.\nZweite Zeile.\n");
    expect(serializeBlocks(parseBlocks(markdown))).toBe(markdown);
  });

  test("constructors normalize surrounding blank lines", () => {
    expect(serializeBlocks([makeCallout("note", "\n  \nText\n\n")])).toBe("> [!note] Text\n");
    expect(makeIfSection("  sie lügen  ").condition).toBe("sie lügen");
    expect(makeHeading(3, " Detail ").text).toBe("Detail");
  });

  test("a new block inserted into a CRLF body keeps CRLF", () => {
    const blocks = parseBlocks("## Flow\r\n\r\nText\r\n");
    const next = insertBlock(blocks, blocks.length, makeCallout("note", "neu\n\nauch neu"));
    expect(serializeBlocks(next)).toBe("## Flow\r\n\r\nText\r\n\r\n> [!note] neu\r\n>\r\n> auch neu\r\n");
  });
});

describe("list operations keep the leading whitespace at the head", () => {
  const body = "\n## Flow\n\nText\n";

  test("inserting at the front does not leak a blank line", () => {
    const next = insertBlock(parseBlocks(body), 0, makeHeading(2, "Vorher"));
    expect(serializeBlocks(next)).toBe("\n## Vorher\n\n## Flow\n\nText\n");
  });

  test("removing the head hands the lead to the new head", () => {
    const blocks = parseBlocks(body);
    const head = blocks[0];
    if (head === undefined) throw new Error("expected a block");
    expect(serializeBlocks(removeBlock(blocks, head.id))).toBe("\nText\n");
  });

  test("moving the head keeps the lead in front", () => {
    expect(serializeBlocks(moveBlock(parseBlocks(body), 0, 1))).toBe("\nText\n\n## Flow\n");
  });
});

describe("degenerate input roundtrips", () => {
  const CASES: Record<string, string> = {
    empty: "",
    "only a newline": "\n",
    "only blank lines": "\n  \n\t\n",
    "no trailing newline": "## Flow\n\nText",
    "crlf everywhere": "\r\n## Flow\r\n\r\n> [!check] DC 13\r\n> zweite Zeile\r\n",
    "unknown callout kind": "> [!warning] Kein bekannter Typ\n> zweite Zeile\n",
    "plain blockquote": "> Nur ein Zitat\n>\n> mit zwei Absätzen\n",
    "nested blockquote": "> [!note] außen\n>\n> > innen\n> > tiefer\n",
    "heading inside a callout": "> [!secret] Text\n> ## keine echte Überschrift\n",
    "callout marker without a space": ">[!note]dicht geschrieben\n",
    "uppercase callout marker": "> [!NOTE] Groß geschrieben\n",
    "blank lines run": "## A\n\n\n\nText\n\n\n",
    "trailing whitespace lines": "Text\n   \n\t\n",
    "if section without a condition": "## If:\n\nText\n",
    "if section with trailing spaces": "## If:   sie lügen   \n\nText\n",
    "closed atx heading": "## Flow ##\n\nText\n",
    "seventh level pseudo heading": "####### kein Heading\n",
    "code fence with structure inside": "```\n## If: nicht echt\n\n> [!note] auch nicht\n```\n",
    "unclosed code fence": "```md\n## If: nicht echt\n",
    "indented code block": "    > [!note] eingerückt\n    ## kein Heading\n",
    "loose list": "- eins\n\n- zwei\n",
    "table": "| a | b |\n| - | - |\n| 1 | 2 |\n",
    "html comment": "<!-- wird von der App befüllt -->\n",
    "lazy blockquote continuation": "> [!note] erste Zeile\nfaul weiter\n",
    "setext heading": "Titel\n=====\n\nText\n",
    "thematic break": "Text\n\n---\n\nmehr\n",
    "callout right after a list": "- eins\n> [!note] direkt danach\n",
    "no blank line between headings": "## A\n## B\n### C\n",
    "windows file without final newline": "## Flow\r\n\r\nText",
    "mixed line endings": "## Flow\n\r\nText\r\n\nmehr\n",
    "if section at the very end": "## Flow\n\n## If: a\n",
    "two if sections in a row": "## If: a\n\n## If: b\n\nText\n",
  };

  for (const [name, body] of Object.entries(CASES)) {
    test(name, () => {
      expect(serializeBlocks(parseBlocks(body))).toBe(body);
    });
  }

  test("an unknown callout kind stays a raw block and is never reformatted", () => {
    const block = parseBlocks("> [!warning] Kein bekannter Typ\n")[0];
    if (block?.type !== "raw") throw new Error("expected a raw block");
    expect(block.calloutKind).toBe("warning");
    // Raw text is verbatim markdown, markers included.
    expect(block.text).toBe("> [!warning] Kein bekannter Typ");
  });

  test("a plain blockquote is a raw block without a callout kind", () => {
    const block = parseBlocks("> Nur ein Zitat\n")[0];
    if (block?.type !== "raw") throw new Error("expected a raw block");
    expect(block.calloutKind).toBeUndefined();
  });

  test("an uppercase marker yields the canonical lowercase kind", () => {
    const block = parseBlocks("> [!NOTE] Groß\n")[0];
    if (block?.type !== "callout") throw new Error("expected a callout");
    expect(block.kind).toBe("note");
    // …while the spelling on disk survives untouched.
    expect(serializeBlocks([block])).toBe("> [!NOTE] Groß\n");
  });

  test("a marker on its own line puts the text on the first line", () => {
    const block = parseBlocks("> [!check]\n> DC 13\n")[0];
    if (block?.type !== "callout") throw new Error("expected a callout");
    expect(block.text).toBe("DC 13");
  });

  test("a whitespace-only body becomes one empty text block", () => {
    const blocks = parseBlocks("\n\n");
    expect(shape(blocks)).toEqual(["text"]);
    const only = blocks[0];
    if (only === undefined) throw new Error("expected a block");
    expect(blockText(only)).toBe("");
    expect(serializeBlocks(blocks)).toBe("\n\n");
  });
});

describe("an emptied block writes nothing at all", () => {
  // renderBlock gives "" for a text/raw block without text, and a block that
  // renders to nothing must not leave its separator behind: `A\n\n\n` is a
  // stray blank line that would also disappear on the way through „Roh".
  test("an edited-empty text block leaves no blank line behind", () => {
    const blocks = parseBlocks("A\n\nB\n");
    const b = blocks[1];
    if (b?.type !== "text") throw new Error("expected a text block");
    expect(serializeBlocks([blocks[0] as SceneBlock, withBlockText(b, "")])).toBe("A\n");
  });

  test("emptying the middle block closes the gap around it", () => {
    const blocks = parseBlocks("A\n\nB\n\nC\n");
    const middle = blocks[1];
    if (middle?.type !== "text") throw new Error("expected a text block");
    const next = blocks.map((block) => (block === middle ? withBlockText(middle, "") : block));
    expect(serializeBlocks(next)).toBe("A\n\nC\n");
  });

  test("a fresh empty block contributes nothing and survives the roundtrip", () => {
    const body = "## Flow\n\nText\n";
    const grown = insertBlock(parseBlocks(body), 1, makeText(""));
    expect(serializeBlocks(grown)).toBe(body);
    // …and the same holds for a block list that is nothing BUT empty blocks.
    expect(serializeBlocks([makeText(""), makeText("")])).toBe("");
  });

  test("the whitespace in front of a dropped head block moves on", () => {
    const blocks = parseBlocks("\nA\n\nB\n");
    const head = blocks[0];
    if (head?.type !== "text") throw new Error("expected a text block");
    const next = blocks.map((block) => (block === head ? withBlockText(head, "") : block));
    // The blank line after the frontmatter fence is the POSITION's, not the
    // block's — it stays in front of whatever is first now.
    expect(serializeBlocks(next)).toBe("\nB\n");
  });
});

describe("the whitespace-only seed", () => {
  test("untouched it is still byte-identical", () => {
    expect(serializeBlocks(parseBlocks("\n\n"))).toBe("\n\n");
  });

  test("typed into, it ends the file with exactly one newline", () => {
    const blocks = parseBlocks("\n\n");
    const seed = blocks[0];
    if (seed?.type !== "text") throw new Error("expected the seed block");
    // Without this the file would be saved without a trailing newline at all
    // (the seed's gap is "" — that is what round-tripped the whitespace).
    expect(serializeBlocks([withBlockText(seed, "Erster Satz.")])).toBe("\n\nErster Satz.\n");
  });

  test("a CRLF-only body keeps CRLF when it is typed into", () => {
    const blocks = parseBlocks("\r\n");
    const seed = blocks[0];
    if (seed?.type !== "text") throw new Error("expected the seed block");
    // The leading blank line is the ONLY evidence of the file's line ending.
    expect(serializeBlocks([withBlockText(seed, "Erster Satz.")])).toBe("\r\nErster Satz.\r\n");
  });

  test("an edited last block of a file without a final newline gets one", () => {
    const blocks = parseBlocks("## Flow\n\nText");
    const last = blocks[1];
    if (last?.type !== "text") throw new Error("expected a text block");
    const next = blocks.map((block) => (block === last ? withBlockText(last, "Neu") : block));
    expect(serializeBlocks(next)).toBe("## Flow\n\nNeu\n");
    // …while leaving it alone leaves the file alone.
    expect(serializeBlocks(blocks)).toBe("## Flow\n\nText");
  });
});

describe("the If-heading is read exactly like the renderer reads it", () => {
  // remark-grimoire matches on mdastToString(heading), which drops emphasis —
  // so these headings collapse into a <details> in the reading view and have to
  // be section cards here, not heading cards.
  const CASES = ["## *If:* sie lügen", "## **If:** sie lügen", "## `If:` sie lügen"];

  for (const heading of CASES) {
    test(`${heading} is a section`, () => {
      const body = `${heading}\n\ndrin\n`;
      expect(shape(parseBlocks(body))).toEqual(["ifSection(text)"]);
      expect(serializeBlocks(parseBlocks(body))).toBe(body);
    });
  }

  test("markup INSIDE the condition is left alone", () => {
    const section = parseBlocks("## If: sie *lügen*\n")[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    expect(section.condition).toBe("sie *lügen*");
  });

  test("a wrapped prefix hands over the condition without its wrappers", () => {
    const section = parseBlocks("## **If:** sie lügen\n")[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    expect(section.condition).toBe("sie lügen");
  });

  test("only H2 is a section — the depth rule is unchanged", () => {
    expect(shape(parseBlocks("### If: zu tief\n"))).toEqual(["heading"]);
    expect(shape(parseBlocks("# If: zu hoch\n"))).toEqual(["heading"]);
  });
});

describe("what ends an If-section", () => {
  test("a heading of depth 1 or 2 at the start of a line does", () => {
    expect(endsIfSectionText("## Flow")).toBe(true);
    expect(endsIfSectionText("# Kapitel")).toBe(true);
    expect(endsIfSectionText("Text\n\n## Flow\n\nmehr")).toBe(true);
    expect(endsIfSectionText("## If: noch eine Bedingung")).toBe(true);
  });

  test("a deeper heading and plain prose do not", () => {
    expect(endsIfSectionText("### Detail")).toBe(false);
    expect(endsIfSectionText("Ein Absatz über ## Rauten.")).toBe(false);
    expect(endsIfSectionText("")).toBe(false);
  });

  test("the parser's own exceptions hold — a `##` is not always a heading", () => {
    // …inside a code fence,
    expect(endsIfSectionText("```md\n## Flow\n```")).toBe(false);
    // …in a blockquote (a callout's text keeps its markers in a raw block),
    expect(endsIfSectionText("> [!note] Text\n> ## keine Überschrift")).toBe(false);
    // …and in an indented code block.
    expect(endsIfSectionText("    ## kein Heading")).toBe(false);
    // An unclosed fence swallows the rest, exactly as the parser does.
    expect(endsIfSectionText("```\n## Flow")).toBe(false);
  });

  test("blockMarkdown is what the serializer would write for one block", () => {
    const parsed = parseBlocks("> [!note]  seltsam    umbrochen\n")[0];
    if (parsed === undefined) throw new Error("expected a block");
    // Untouched: verbatim, spelling included.
    expect(blockMarkdown(parsed)).toBe("> [!note]  seltsam    umbrochen");
    // Edited or constructed: the house style.
    expect(blockMarkdown(makeHeading(3, "Danach"))).toBe("### Danach");
    expect(blockMarkdown(makeText(""))).toBe("");
  });
});

describe("the invariant under a seeded fuzz", () => {
  // Hand-picked cases only prove the cases somebody thought of. This glues
  // random line fragments together and demands the same byte-identity — with a
  // fixed seed, so a failure is reproducible and lands in CI, not in the DM's
  // file.
  const FRAGMENTS = [
    "",
    "   ",
    "# Kapitel",
    "## Flow",
    "## If: sie lügen",
    "## If:",
    "### Detail",
    "###### tief",
    "Ein Absatz mit Text.",
    "noch eine Zeile",
    "- ein Listenpunkt",
    "1. erster",
    "> [!readaloud] Vorlesetext",
    "> [!check] DC 13",
    "> [!warning] unbekannt",
    "> weiter im Zitat",
    ">",
    "> > tiefer verschachtelt",
    "```",
    "```ts",
    "| a | b |",
    "---",
    "<!-- Kommentar -->",
    "    eingerückter Code",
    "Text mit zwei Leerzeichen  ",
  ];

  function lcg(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  test("500 random bodies roundtrip byte-identically", () => {
    const random = lcg(20260821);
    const failures: string[] = [];
    for (let round = 0; round < 500; round++) {
      const count = 1 + Math.floor(random() * 12);
      const lines: string[] = [];
      for (let i = 0; i < count; i++) {
        lines.push(FRAGMENTS[Math.floor(random() * FRAGMENTS.length)] ?? "");
      }
      const trailing = random() < 0.8 ? "\n" : "";
      const lf = lines.join("\n") + trailing;
      for (const body of [lf, lf.replace(/\n/g, "\r\n")]) {
        if (serializeBlocks(parseBlocks(body)) !== body) failures.push(JSON.stringify(body));
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("list operations are lossless when nothing actually moves", () => {
  test("moving a block onto itself leaves every example untouched", () => {
    for (const rel of exampleFiles()) {
      const body = exampleBody(rel);
      const blocks = parseBlocks(body);
      for (let i = 0; i < blocks.length; i++) {
        expect(serializeBlocks(moveBlock(blocks, i, i))).toBe(body);
      }
    }
  });

  test("insert then remove restores the body", () => {
    const body = exampleBody("beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md");
    const blocks = parseBlocks(body);
    const fresh = makeCallout("loot", "Ein Silberring am Daumen.");
    for (let at = 0; at <= blocks.length; at++) {
      const inserted = insertBlock(blocks, at, fresh);
      expect(serializeBlocks(inserted)).toContain("> [!loot] Ein Silberring am Daumen.");
      expect(serializeBlocks(removeBlock(inserted, fresh.id))).toBe(body);
    }
  });
});

describe("labels", () => {
  test("the six callouts use the names the reading view already shows", () => {
    const kinds = ["readaloud", "check", "secret", "outcome", "loot", "note"] as const;
    const expected = ["Vorlesetext", "Check", "Geheim", "Konsequenz", "Beute", "Notiz"];
    expect(kinds.map((kind) => blockLabel(makeCallout(kind, "x")))).toEqual(expected);
    expect(kinds.map(calloutLabel)).toEqual(expected);
  });

  test("structural blocks are named in German", () => {
    expect(blockLabel(makeIfSection("a"))).toBe("Falls-Abschnitt");
    expect(blockLabel(makeHeading(2, "Flow"))).toBe("Überschrift");
    expect(blockLabel(makeText("Absatz"))).toBe("Text");
    const raw = parseBlocks("> [!warning] x\n")[0];
    if (raw === undefined) throw new Error("expected a block");
    expect(blockLabel(raw)).toBe("Roh-Block");
  });

  test("ids are unique across blocks and parses", () => {
    const ids = [
      ...parseBlocks(exampleBody("beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md")),
      ...parseBlocks(exampleBody("beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md")),
      makeText("neu"),
    ].map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
