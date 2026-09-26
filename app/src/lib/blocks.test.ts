// The heart of the block composer: the round-trip.
//
// A composer that rewrites a hand-edited body on open is worse than no
// composer, so the central test is not a unit test at all — it reads the body
// of EVERY fixture, exactly as the app receives it from the API, and
// demands `serializeBlocks(parseBlocks(body)) === body`, byte for byte.
// Blank-line runs, `>` styles, wrapping, the trailing newline: nothing may
// move.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { translator } from "@/i18n/format";

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

const FIXTURES = new URL("../../../fixtures/beispiel/", import.meta.url);

/** A fixture as it is stored: the shape the API speaks. */
function fixture(name: string): { body?: string } {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")) as { body?: string };
}

/**
 * Every fixture that carries a body, sorted — the session in the campaign
 * directory itself, and the campaign, its chapters, scenes, npcs and
 * locations, each in its own directory (`campaigns/<id>.json`,
 * `chapters/<id>.json`, `scenes/<id>.json`, …).
 */
function fixtureFiles(): string[] {
  const inDir = (dir: string): string[] =>
    readdirSync(new URL(dir, FIXTURES), { encoding: "utf8" })
      .filter((name) => name.endsWith(".json"))
      .map((name) => `${dir}${name}`);
  return ["", "campaigns/", "chapters/", "scenes/", "npcs/", "locations/"]
    .flatMap(inDir)
    .filter((name) => fixture(name).body !== undefined)
    .sort();
}

/** The body as the app sees it: whatever the resource answered. */
function fixtureBody(name: string): string {
  const body = fixture(name).body;
  if (body === undefined) throw new Error(`fixture ${name} has no body`);
  return body;
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

describe("roundtrip over the fixtures", () => {
  const files = fixtureFiles();

  test("finds the example campaign", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("scenes/lighthouse-arrival.json");
  });

  for (const rel of files) {
    test(`${rel} is byte-identical after a roundtrip`, () => {
      const body = fixtureBody(rel);
      expect(serializeBlocks(parseBlocks(body))).toBe(body);
    });
  }

  test("every fixture body produces at least one block", () => {
    for (const rel of files) {
      expect(parseBlocks(fixtureBody(rel)).length).toBeGreaterThan(0);
    }
  });

  test("`[[slug]]` references survive the roundtrip untouched", () => {
    // The composer needs NO special case for references — they are ordinary
    // text — but that it is ordinary text is a claim, and this is what pins
    // it: the
    // brackets must come back out of the editor exactly as they went in, in
    // prose, in a callout, in an if-section and in a heading.
    const body = [
      "## Flow",
      "",
      "At the quay [[jorna]]s boat waits, [[lighthouse]] lies dark.",
      "",
      "> [!readaloud] [[jorna]] does not look at you.",
      "",
      "## If: they ask about [[fenn]]",
      "",
      "Then [[jorna]] falls silent — and [[nobody]] helps them.",
      "",
    ].join("\n");
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
    expect(blockText(parseBlocks(body)[1]!)).toContain("[[jorna]]s boat");
  });
});

describe("structure of the reference scenes", () => {
  test("lighthouse arrival: Flow plus the four callouts", () => {
    const blocks = parseBlocks(fixtureBody("scenes/lighthouse-arrival.json"));
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
    // The body starts with the blank line that separated it from the properties.
    expect(heading.lead).toBe("\n");

    const readaloud = blocks[2];
    if (readaloud?.type !== "callout") throw new Error("expected a callout");
    expect(readaloud.kind).toBe("readaloud");
    expect(readaloud.text.startsWith("Der Turm ragt schwarz")).toBe(true);
    // The `>` markers are gone, the hand-wrapped soft breaks are not.
    expect(readaloud.text).not.toContain(">");
    expect(readaloud.text.split("\n")).toHaveLength(4);
  });

  test("smuggler captured: two If-sections with their children", () => {
    const blocks = parseBlocks(
      fixtureBody("scenes/smuggler-captured.json"),
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
    const body = "## If: a\n\ninside\n\n## Flow\n\noutside\n";
    expect(shape(parseBlocks(body))).toEqual(["ifSection(text)", "heading", "text"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });

  test("a deeper heading stays inside the If-section", () => {
    const body = "## If: a\n\n### Detail\n\ninside\n";
    expect(shape(parseBlocks(body))).toEqual(["ifSection(heading,text)"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });
});

describe("editing a block", () => {
  const rel = "scenes/lighthouse-arrival.json";

  test("only the edited callout changes, every sibling byte-identical", () => {
    const body = fixtureBody(rel);
    const blocks = parseBlocks(body);
    const original = blocks[2];
    if (original?.type !== "callout") throw new Error("expected the readaloud callout");
    const before = original.source;
    if (before === undefined) throw new Error("parsed blocks carry their source");

    const edited = withBlockText(original, "The tower stands still. No light.");
    expect(edited.source).toBeUndefined();
    expect(edited.gap).toBe(original.gap); // a separator is not content

    const next = serializeBlocks(blocks.map((b) => (b === original ? edited : b)));
    expect(next).toBe(
      body.replace(before, "> [!readaloud] The tower stands still. No light."),
    );
    // Nothing else moved: cutting the changed region out leaves the rest equal.
    expect(next.split("> [!readaloud]")[0]).toBe(body.split("> [!readaloud]")[0]);
  });

  test("an edited multi-paragraph callout renders bare `>` for blank lines", () => {
    const blocks = parseBlocks("> [!note] old\n");
    const note = blocks[0];
    if (note?.type !== "callout") throw new Error("expected a callout");
    expect(serializeBlocks([withBlockText(note, "one\n\ntwo")])).toBe(
      "> [!note] one\n>\n> two\n",
    );
  });

  test("editing an If-condition keeps the children verbatim", () => {
    const body = "## If: old\n\n> [!note]  oddly    wrapped\n> onward\n";
    const blocks = parseBlocks(body);
    const section = blocks[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    const next = serializeBlocks([withIfCondition(section, "new")]);
    expect(next).toBe("## If: new\n\n> [!note]  oddly    wrapped\n> onward\n");
  });

  test("editing a child of a section is not swallowed by the section", () => {
    const body = "## If: a\n\n> [!check] old\n";
    const blocks = parseBlocks(body);
    const section = blocks[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    const child = section.children[0];
    if (child?.type !== "callout") throw new Error("expected a callout child");
    const next = serializeBlocks([withChildren(section, [withBlockText(child, "new")])]);
    expect(next).toBe("## If: a\n\n> [!check] new\n");
  });
});

describe("constructors", () => {
  test("a new callout parses back into the same block", () => {
    const block = makeCallout("readaloud", "The tower stands still.");
    const markdown = serializeBlocks([block]);
    expect(markdown).toBe("> [!readaloud] The tower stands still.\n");
    const reparsed = parseBlocks(markdown)[0];
    if (reparsed?.type !== "callout") throw new Error("expected a callout");
    expect(reparsed.kind).toBe("readaloud");
    expect(reparsed.text).toBe(block.text);
    expect(serializeBlocks([reparsed])).toBe(markdown);
  });

  test("every callout kind is a fixpoint, single-paragraph and multi", () => {
    for (const kind of ["readaloud", "check", "secret", "outcome", "loot", "note"] as const) {
      for (const text of ["short", "one\n\ntwo", "one line\nanother one"]) {
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
    const section = makeIfSection("they lie", [
      makeCallout("check", "Charisma (Deception) vs. Wisdom (Insight)."),
      makeText("- believed\n- not believed"),
    ]);
    const markdown = serializeBlocks([section]);
    expect(markdown).toBe(
      "## If: they lie\n\n> [!check] Charisma (Deception) vs. Wisdom (Insight).\n\n- believed\n- not believed\n",
    );
    expect(shape(parseBlocks(markdown))).toEqual(["ifSection(callout:check,text)"]);
    expect(serializeBlocks(parseBlocks(markdown))).toBe(markdown);
  });

  test("headings and text blocks are fixpoints", () => {
    const blocks = [makeHeading(2, "Flow"), makeText("A paragraph.\nSecond line.")];
    const markdown = serializeBlocks(blocks);
    expect(markdown).toBe("## Flow\n\nA paragraph.\nSecond line.\n");
    expect(serializeBlocks(parseBlocks(markdown))).toBe(markdown);
  });

  test("constructors normalize surrounding blank lines", () => {
    expect(serializeBlocks([makeCallout("note", "\n  \nText\n\n")])).toBe("> [!note] Text\n");
    expect(makeIfSection("  they lie  ").condition).toBe("they lie");
    expect(makeHeading(3, " Detail ").text).toBe("Detail");
  });

  test("a new block inserted into a CRLF body keeps CRLF", () => {
    const blocks = parseBlocks("## Flow\r\n\r\nText\r\n");
    const next = insertBlock(blocks, blocks.length, makeCallout("note", "new\n\nalso new"));
    expect(serializeBlocks(next)).toBe("## Flow\r\n\r\nText\r\n\r\n> [!note] new\r\n>\r\n> also new\r\n");
  });
});

describe("list operations keep the leading whitespace at the head", () => {
  const body = "\n## Flow\n\nText\n";

  test("inserting at the front does not leak a blank line", () => {
    const next = insertBlock(parseBlocks(body), 0, makeHeading(2, "Before"));
    expect(serializeBlocks(next)).toBe("\n## Before\n\n## Flow\n\nText\n");
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
    "crlf everywhere": "\r\n## Flow\r\n\r\n> [!check] DC 13\r\n> second line\r\n",
    "unknown callout kind": "> [!warning] No known type\n> second line\n",
    "plain blockquote": "> Just a quote\n>\n> with two paragraphs\n",
    "nested blockquote": "> [!note] outer\n>\n> > inner\n> > deeper\n",
    "heading inside a callout": "> [!secret] Text\n> ## not a real heading\n",
    "callout marker without a space": ">[!note]tightly written\n",
    "uppercase callout marker": "> [!NOTE] Upper case\n",
    "blank lines run": "## A\n\n\n\nText\n\n\n",
    "trailing whitespace lines": "Text\n   \n\t\n",
    "if section without a condition": "## If:\n\nText\n",
    "if section with trailing spaces": "## If:   they lie   \n\nText\n",
    "closed atx heading": "## Flow ##\n\nText\n",
    "seventh level pseudo heading": "####### no heading\n",
    "code fence with structure inside": "```\n## If: not real\n\n> [!note] neither\n```\n",
    "unclosed code fence": "```md\n## If: not real\n",
    "indented code block": "    > [!note] indented\n    ## no heading\n",
    "loose list": "- one\n\n- two\n",
    "table": "| a | b |\n| - | - |\n| 1 | 2 |\n",
    "html comment": "<!-- filled in by the app -->\n",
    "lazy blockquote continuation": "> [!note] first line\nlazily onward\n",
    "setext heading": "Title\n=====\n\nText\n",
    "thematic break": "Text\n\n---\n\nmore\n",
    "callout right after a list": "- one\n> [!note] right after\n",
    "no blank line between headings": "## A\n## B\n### C\n",
    "windows text without final newline": "## Flow\r\n\r\nText",
    "mixed line endings": "## Flow\n\r\nText\r\n\nmore\n",
    "if section at the very end": "## Flow\n\n## If: a\n",
    "two if sections in a row": "## If: a\n\n## If: b\n\nText\n",
  };

  for (const [name, body] of Object.entries(CASES)) {
    test(name, () => {
      expect(serializeBlocks(parseBlocks(body))).toBe(body);
    });
  }

  test("an unknown callout kind stays a raw block and is never reformatted", () => {
    const block = parseBlocks("> [!warning] No known type\n")[0];
    if (block?.type !== "markdown") throw new Error("expected a raw block");
    expect(block.calloutKind).toBe("warning");
    // Raw text is verbatim markdown, markers included.
    expect(block.text).toBe("> [!warning] No known type");
  });

  test("a plain blockquote is a raw block without a callout kind", () => {
    const block = parseBlocks("> Just a quote\n")[0];
    if (block?.type !== "markdown") throw new Error("expected a raw block");
    expect(block.calloutKind).toBeUndefined();
  });

  test("an uppercase marker yields the canonical lowercase kind", () => {
    const block = parseBlocks("> [!NOTE] Upper\n")[0];
    if (block?.type !== "callout") throw new Error("expected a callout");
    expect(block.kind).toBe("note");
    // …while the stored spelling survives untouched.
    expect(serializeBlocks([block])).toBe("> [!NOTE] Upper\n");
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
  // stray blank line that would also disappear on the way through the raw
  // surface.
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
    // The blank line after the properties fence is the POSITION's, not the
    // block's — it stays in front of whatever is first now.
    expect(serializeBlocks(next)).toBe("\nB\n");
  });
});

describe("the whitespace-only seed", () => {
  test("untouched it is still byte-identical", () => {
    expect(serializeBlocks(parseBlocks("\n\n"))).toBe("\n\n");
  });

  test("typed into, it ends the body with exactly one newline", () => {
    const blocks = parseBlocks("\n\n");
    const seed = blocks[0];
    if (seed?.type !== "text") throw new Error("expected the seed block");
    // Without this the body would be saved without a trailing newline at all
    // (the seed's gap is "" — that is what round-tripped the whitespace).
    expect(serializeBlocks([withBlockText(seed, "First sentence.")])).toBe("\n\nFirst sentence.\n");
  });

  test("a CRLF-only body keeps CRLF when it is typed into", () => {
    const blocks = parseBlocks("\r\n");
    const seed = blocks[0];
    if (seed?.type !== "text") throw new Error("expected the seed block");
    // The leading blank line is the ONLY evidence of the body's line ending.
    expect(serializeBlocks([withBlockText(seed, "First sentence.")])).toBe("\r\nFirst sentence.\r\n");
  });

  test("an edited last block of a body without a final newline gets one", () => {
    const blocks = parseBlocks("## Flow\n\nText");
    const last = blocks[1];
    if (last?.type !== "text") throw new Error("expected a text block");
    const next = blocks.map((block) => (block === last ? withBlockText(last, "New") : block));
    expect(serializeBlocks(next)).toBe("## Flow\n\nNew\n");
    // …while leaving it alone leaves the body alone.
    expect(serializeBlocks(blocks)).toBe("## Flow\n\nText");
  });
});

describe("the If-heading is read exactly like the renderer reads it", () => {
  // remark-grimoire matches on mdastToString(heading), which drops emphasis —
  // so these headings collapse into a <details> in the reading view and have to
  // be section cards here, not heading cards.
  const CASES = ["## *If:* they lie", "## **If:** they lie", "## `If:` they lie"];

  for (const heading of CASES) {
    test(`${heading} is a section`, () => {
      const body = `${heading}\n\ninside\n`;
      expect(shape(parseBlocks(body))).toEqual(["ifSection(text)"]);
      expect(serializeBlocks(parseBlocks(body))).toBe(body);
    });
  }

  test("markup INSIDE the condition is left alone", () => {
    const section = parseBlocks("## If: they *lie*\n")[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    expect(section.condition).toBe("they *lie*");
  });

  test("a wrapped prefix hands over the condition without its wrappers", () => {
    const section = parseBlocks("## **If:** they lie\n")[0];
    if (section?.type !== "ifSection") throw new Error("expected an If-section");
    expect(section.condition).toBe("they lie");
  });

  test("only H2 is a section — the depth rule is unchanged", () => {
    expect(shape(parseBlocks("### If: too deep\n"))).toEqual(["heading"]);
    expect(shape(parseBlocks("# If: too high\n"))).toEqual(["heading"]);
  });
});

describe("what ends an If-section", () => {
  test("a heading of depth 1 or 2 at the start of a line does", () => {
    expect(endsIfSectionText("## Flow")).toBe(true);
    expect(endsIfSectionText("# Chapter")).toBe(true);
    expect(endsIfSectionText("Text\n\n## Flow\n\nmore")).toBe(true);
    expect(endsIfSectionText("## If: another condition")).toBe(true);
  });

  test("a deeper heading and plain prose do not", () => {
    expect(endsIfSectionText("### Detail")).toBe(false);
    expect(endsIfSectionText("A paragraph about ## hashes.")).toBe(false);
    expect(endsIfSectionText("")).toBe(false);
  });

  test("the parser's own exceptions hold — a `##` is not always a heading", () => {
    // …inside a code fence,
    expect(endsIfSectionText("```md\n## Flow\n```")).toBe(false);
    // …in a blockquote (a callout's text keeps its markers in a raw block),
    expect(endsIfSectionText("> [!note] Text\n> ## no heading")).toBe(false);
    // …and in an indented code block.
    expect(endsIfSectionText("    ## no heading")).toBe(false);
    // An unclosed fence swallows the rest, exactly as the parser does.
    expect(endsIfSectionText("```\n## Flow")).toBe(false);
  });

  test("blockMarkdown is what the serializer would write for one block", () => {
    const parsed = parseBlocks("> [!note]  oddly    wrapped\n")[0];
    if (parsed === undefined) throw new Error("expected a block");
    // Untouched: verbatim, spelling included.
    expect(blockMarkdown(parsed)).toBe("> [!note]  oddly    wrapped");
    // Edited or constructed: the house style.
    expect(blockMarkdown(makeHeading(3, "After"))).toBe("### After");
    expect(blockMarkdown(makeText(""))).toBe("");
  });
});

describe("the invariant under a seeded fuzz", () => {
  // Hand-picked cases only prove the cases somebody thought of. This glues
  // random line fragments together and demands the same byte-identity — with a
  // fixed seed, so a failure is reproducible and lands in CI, not in the DM's
  // body.
  const FRAGMENTS = [
    "",
    "   ",
    "# Chapter",
    "## Flow",
    "## If: they lie",
    "## If:",
    "### Detail",
    "###### deep",
    "A paragraph with text.",
    "another line",
    "- a list item",
    "1. first",
    "> [!readaloud] Read-aloud text",
    "> [!check] DC 13",
    "> [!warning] unknown",
    "> quote continues",
    ">",
    "> > nested deeper",
    "```",
    "```ts",
    "| a | b |",
    "---",
    "<!-- comment -->",
    "    indented code",
    "Text with two spaces  ",
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
  test("moving a block onto itself leaves every fixture body untouched", () => {
    for (const rel of fixtureFiles()) {
      const body = fixtureBody(rel);
      const blocks = parseBlocks(body);
      for (let i = 0; i < blocks.length; i++) {
        expect(serializeBlocks(moveBlock(blocks, i, i))).toBe(body);
      }
    }
  });

  test("insert then remove restores the body", () => {
    const body = fixtureBody("scenes/lighthouse-arrival.json");
    const blocks = parseBlocks(body);
    const fresh = makeCallout("loot", "A silver ring on the thumb.");
    for (let at = 0; at <= blocks.length; at++) {
      const inserted = insertBlock(blocks, at, fresh);
      expect(serializeBlocks(inserted)).toContain("> [!loot] A silver ring on the thumb.");
      expect(serializeBlocks(removeBlock(inserted, fresh.id))).toBe(body);
    }
  });
});

// The labels come from the catalog and the translator is passed in
// (decisions/i18n): a callout is named with the key the reading view uses.
const t = translator("de");

describe("labels", () => {
  test("the six callouts use the names the reading view already shows", () => {
    const kinds = ["readaloud", "check", "secret", "outcome", "loot", "note"] as const;
    const expected = kinds.map((kind) => t(`markdown.callout.${kind}`));
    expect(kinds.map((kind) => blockLabel(makeCallout(kind, "x"), t))).toEqual(expected);
    expect(kinds.map((kind) => calloutLabel(kind, t))).toEqual(expected);
  });

  test("structural blocks are named by their block type", () => {
    expect(blockLabel(makeIfSection("a"), t)).toBe(t("composer.blockType.ifSection"));
    expect(blockLabel(makeHeading(2, "Flow"), t)).toBe(t("composer.blockType.heading"));
    expect(blockLabel(makeText("Paragraph"), t)).toBe(t("composer.blockType.text"));
    const raw = parseBlocks("> [!warning] x\n")[0];
    if (raw === undefined) throw new Error("expected a block");
    expect(blockLabel(raw, t)).toBe(t("composer.blockType.markdown"));
  });

  test("ids are unique across blocks and parses", () => {
    const ids = [
      ...parseBlocks(fixtureBody("scenes/lighthouse-arrival.json")),
      ...parseBlocks(fixtureBody("scenes/lighthouse-arrival.json")),
      makeText("new"),
    ].map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --- tables ------------------------------------------------------------------
//
// A table is NOT a block type. It is markdown inside a text block (or
// inside a callout's text): the line scan never splits on a `|` line. These
// tests nail that down, so modelling tables as blocks has to argue with the
// round-trip.

describe("tables are part of a text block, byte-stable", () => {
  const D6 = [
    "| d6 | What drifts in the bay |",
    "| --- | --- |",
    "| 1 | An empty barrel |",
    "| 2 | A notched oar |",
  ].join("\n");

  test("a table is ONE text block, not one per row", () => {
    const body = `${D6}\n`;
    expect(shape(parseBlocks(body))).toEqual(["text"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });

  test("prose, table and prose stay three blocks and round-trip", () => {
    const body = `Before.\n\n${D6}\n\nAfter.\n`;
    expect(shape(parseBlocks(body))).toEqual(["text", "text", "text"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });

  test("a table inside a callout is part of the callout's text", () => {
    const quoted = D6.split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const body = `> [!note] Random table\n>\n${quoted}\n`;
    const blocks = parseBlocks(body);
    expect(shape(blocks)).toEqual(["callout:note"]);
    const callout = blocks[0];
    if (callout?.type !== "callout") throw new Error("expected a callout");
    // The `>` markers are stripped, the table's own pipes are not.
    expect(callout.text).toContain("| --- | --- |");
    expect(callout.text).not.toContain(">");
    expect(serializeBlocks(blocks)).toBe(body);
  });

  test("a table inside an If-section round-trips with the section", () => {
    const body = `## If: they roll\n\n${D6}\n`;
    expect(shape(parseBlocks(body))).toEqual(["ifSection(text)"]);
    expect(serializeBlocks(parseBlocks(body))).toBe(body);
  });

  test("the reference scene's own table survives a re-serialize", () => {
    const rel = "scenes/lighthouse-arrival.json";
    const body = fixtureBody(rel);
    expect(body).toContain("| W6 | Was die Brandung anschwemmt |");
    const blocks = parseBlocks(body);
    const note = blocks[blocks.length - 1];
    if (note?.type !== "callout") throw new Error("expected the note callout");
    expect(note.kind).toBe("note");
    expect(note.text).toContain("| 5\u20136 | Eine Laterne, das Glas ru\u00dfgeschw\u00e4rzt |");
    expect(serializeBlocks(blocks)).toBe(body);
  });
});
