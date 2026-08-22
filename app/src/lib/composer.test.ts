// The composer's rules (issue #43, phase 2). Two things must hold or the UI is
// dangerous:
//
//   1. The mode switch is lossless. Blöcke → Roh → Blöcke over every file in
//      examples/ must give back the same bytes — the DM has to be able to peek
//      at the raw markdown without paying for it.
//   2. Every edit goes through the phase-1 helpers. The observable proof is
//      `source`: the edited block loses it (it is rendered from its fields from
//      now on) and every sibling keeps it (it stays byte-identical). A
//      hand-rolled spread would keep a stale source and silently drop the edit.

import { parseMarkdown } from "@grimoire/shared";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  makeCallout,
  makeHeading,
  makeText,
  parseBlocks,
  serializeBlocks,
  type IfSectionBlock,
  type SceneBlock,
} from "./blocks";
import {
  composerDraft,
  composerIssues,
  draftBody,
  headingDepths,
  insertAt,
  moveBy,
  newBlockOptions,
  removeAt,
  sameInsertAt,
  setBlockText,
  setHeadingDepth,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
} from "./composer";

const EXAMPLES = new URL("../../../examples/", import.meta.url);
const ARRIVAL = "beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md";
const SMUGGLERS = "beispiel/01-salzhafen/hafen/von-schmugglern-erwischt.md";

function exampleFiles(): string[] {
  return readdirSync(EXAMPLES, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.replace(/\\/g, "/"))
    .sort();
}

/** The body as the app sees it (ParsedFile.body) — what the editor is seeded from. */
function exampleBody(rel: string): string {
  return parseMarkdown(readFileSync(new URL(rel, EXAMPLES), "utf8"), rel, 0).body;
}

function section(blocks: SceneBlock[], index: number): IfSectionBlock {
  const block = blocks[index];
  if (block?.type !== "ifSection") throw new Error(`block ${index} is not an If-section`);
  return block;
}

function at(blocks: SceneBlock[], index: number): SceneBlock {
  const block = blocks[index];
  if (block === undefined) throw new Error(`no block at ${index}`);
  return block;
}

describe("the draft and its two surfaces", () => {
  test("a fresh draft opens in the composer", () => {
    const draft = composerDraft(exampleBody(ARRIVAL));
    expect(draft.mode).toBe("blocks");
    if (draft.mode !== "blocks") throw new Error("unreachable");
    expect(draft.blocks.length).toBeGreaterThan(0);
  });

  test("Blöcke → Roh → Blöcke keeps every example byte-identical", () => {
    for (const rel of exampleFiles()) {
      const body = exampleBody(rel);
      const blocks = composerDraft(body);
      expect(draftBody(blocks)).toBe(body);
      const raw = withDraftMode(blocks, "raw");
      expect(raw.mode).toBe("raw");
      if (raw.mode !== "raw") throw new Error("unreachable");
      // What the textarea shows IS the file — no normalization on the way in.
      expect(raw.text).toBe(body);
      expect(draftBody(withDraftMode(raw, "blocks"))).toBe(body);
    }
  });

  test("switching to the mode already on screen changes nothing at all", () => {
    const draft = composerDraft(exampleBody(ARRIVAL));
    // Same object: a re-parse would hand out new block ids and collapse the
    // open form for a click that meant „stay here".
    expect(withDraftMode(draft, "blocks")).toBe(draft);
    const raw = withDraftText("## Flow\n");
    expect(withDraftMode(raw, "raw")).toBe(raw);
  });

  test("text typed in Roh survives the way back into the blocks", () => {
    const raw = withDraftText("## Flow\n\n> [!loot] Ein Silberring.\n");
    const blocks = withDraftMode(raw, "blocks");
    if (blocks.mode !== "blocks") throw new Error("unreachable");
    expect(blocks.blocks.map((block) => block.type)).toEqual(["heading", "callout"]);
    expect(draftBody(blocks)).toBe("## Flow\n\n> [!loot] Ein Silberring.\n");
  });

  test("an edit made in Blöcke is what Roh then shows", () => {
    const draft = composerDraft("> [!note] alt\n");
    if (draft.mode !== "blocks") throw new Error("unreachable");
    const edited = withDraftBlocks(setBlockText(draft.blocks, at(draft.blocks, 0).id, "neu"));
    const raw = withDraftMode(edited, "raw");
    if (raw.mode !== "raw") throw new Error("unreachable");
    expect(raw.text).toBe("> [!note] neu\n");
  });

  test("an empty body is a draft the composer can still be typed into", () => {
    const draft = composerDraft("");
    if (draft.mode !== "blocks") throw new Error("unreachable");
    expect(draft.blocks).toEqual([]);
    expect(draftBody(draft)).toBe("");
    const filled = insertAt(draft.blocks, { index: 0 }, makeCallout("note", "erster Block"));
    expect(serializeBlocks(filled)).toBe("> [!note] erster Block\n");
  });
});

describe("editing a block", () => {
  test("the edited block loses its source, every sibling keeps it", () => {
    const body = exampleBody(ARRIVAL);
    const blocks = parseBlocks(body);
    const readaloud = at(blocks, 2);
    const next = setBlockText(blocks, readaloud.id, "Der Turm steht still.");

    expect(at(next, 2).source).toBeUndefined();
    expect(next.filter((block) => block.source === undefined)).toHaveLength(1);
    expect(serializeBlocks(next)).toBe(
      body.replace(at(blocks, 2).source ?? "", "> [!readaloud] Der Turm steht still."),
    );
  });

  test("a section's text field is its condition, the children stay untouched", () => {
    const body = exampleBody(SMUGGLERS);
    const blocks = parseBlocks(body);
    const first = section(blocks, 2);
    const next = setBlockText(blocks, first.id, "sie schweigen");

    const edited = section(next, 2);
    expect(edited.condition).toBe("sie schweigen");
    expect(edited.source).toBeUndefined();
    expect(edited.children).toEqual(first.children);
    expect(serializeBlocks(next)).toBe(
      body.replace("## If: sie geben zu, für Jorna zu arbeiten", "## If: sie schweigen"),
    );
  });

  test("a child of a section is edited in place, the heading keeps its source", () => {
    const body = exampleBody(SMUGGLERS);
    const blocks = parseBlocks(body);
    const child = at(section(blocks, 2).children, 2);
    const next = setBlockText(blocks, child.id, "Jorna erfährt davon.");

    const edited = section(next, 2);
    expect(edited.source).toBe("## If: sie geben zu, für Jorna zu arbeiten");
    expect(at(edited.children, 2).source).toBeUndefined();
    expect(at(edited.children, 0).source).toBe(at(section(blocks, 2).children, 0).source);
    expect(serializeBlocks(next)).toContain("> [!note] Jorna erfährt davon.");
  });

  test("a heading's level changes without keeping the old heading line", () => {
    const blocks = parseBlocks("## Flow\n\nText\n");
    const next = setHeadingDepth(blocks, at(blocks, 0).id, 3);
    const heading = at(next, 0);
    if (heading.type !== "heading") throw new Error("expected a heading");
    expect(heading.depth).toBe(3);
    expect(heading.source).toBeUndefined();
    expect(serializeBlocks(next)).toBe("### Flow\n\nText\n");
  });

  test("setBlockText on an unknown id leaves the list alone", () => {
    const blocks = parseBlocks(exampleBody(ARRIVAL));
    expect(serializeBlocks(setBlockText(blocks, "blk-nope", "x"))).toBe(exampleBody(ARRIVAL));
  });
});

describe("insert, move, remove", () => {
  test("a new callout lands between two blocks and nothing else moves", () => {
    const body = exampleBody(ARRIVAL);
    const blocks = parseBlocks(body);
    const loot = makeCallout("loot", "Ein Silberring am Daumen.");
    const next = insertAt(blocks, { index: 3 }, loot);

    expect(next.map((block) => block.type)).toEqual([
      "heading",
      "text",
      "callout",
      "callout",
      "callout",
      "callout",
      "callout",
    ]);
    const markdown = serializeBlocks(next);
    expect(markdown).toContain("> [!loot] Ein Silberring am Daumen.");
    // Insert then remove is the identity — the scaffolding went back in place.
    expect(serializeBlocks(removeAt(next, loot.id))).toBe(body);
  });

  test("a new block inside a section becomes a child of that section", () => {
    const body = exampleBody(SMUGGLERS);
    const blocks = parseBlocks(body);
    const target = section(blocks, 3);
    const heading = makeHeading(3, "Danach");
    const next = insertAt(blocks, { sectionId: target.id, index: 0 }, heading);

    const grown = section(next, 3);
    expect(grown.children).toHaveLength(target.children.length + 1);
    expect(at(grown.children, 0).id).toBe(heading.id);
    // The section itself was not rewritten — its heading line is still verbatim.
    expect(grown.source).toBe(target.source);
    expect(serializeBlocks(next)).toContain("### Danach");
    expect(serializeBlocks(removeAt(next, heading.id))).toBe(body);
  });

  test("the first child of a childless section gets a blank line of room", () => {
    // „## If: a" as the last line of a file has a gap of one newline; the child
    // would otherwise land directly under the heading.
    const blocks = parseBlocks("## Flow\n\n## If: sie fliehen\n");
    const target = section(blocks, 1);
    const next = insertAt(blocks, { sectionId: target.id, index: 0 }, makeCallout("check", "DC 13"));
    expect(serializeBlocks(next)).toBe(
      "## Flow\n\n## If: sie fliehen\n\n> [!check] DC 13\n",
    );
    // …and the heading itself was not re-rendered from its fields.
    expect(section(next, 1).source).toBe("## If: sie fliehen");
  });

  test("the first child of a section with children gets its blank line too", () => {
    // A hand-written file may glue the first child to the heading; inserting
    // ABOVE that child must not glue the new block to the `## If:` line.
    const blocks = parseBlocks("## Flow\n\n## If: sie fliehen\ndrin\n");
    const target = section(blocks, 1);
    expect(target.children).toHaveLength(1);
    const next = insertAt(blocks, { sectionId: target.id, index: 0 }, makeCallout("check", "DC 13"));
    expect(serializeBlocks(next)).toBe(
      "## Flow\n\n## If: sie fliehen\n\n> [!check] DC 13\n\ndrin\n",
    );
    expect(section(next, 1).source).toBe("## If: sie fliehen");
  });

  test("inserting further down leaves the heading's own gap alone", () => {
    const blocks = parseBlocks("## If: sie fliehen\ndrin\n");
    const target = section(blocks, 0);
    const next = insertAt(blocks, { sectionId: target.id, index: 1 }, makeText("danach"));
    // The glued first line is the DM's file — only the new block gets room.
    expect(serializeBlocks(next)).toBe("## If: sie fliehen\ndrin\n\ndanach\n");
  });

  test("moving swaps two neighbours and leaves the file's whitespace alone", () => {
    const body = exampleBody(ARRIVAL);
    const blocks = parseBlocks(body);
    const moved = moveBy(blocks, at(blocks, 2).id, 1);
    expect(moved.map((block) => block.id)).toEqual([
      at(blocks, 0).id,
      at(blocks, 1).id,
      at(blocks, 3).id,
      at(blocks, 2).id,
      at(blocks, 4).id,
      at(blocks, 5).id,
    ]);
    // Moving back restores the file byte for byte.
    expect(serializeBlocks(moveBy(moved, at(blocks, 2).id, -1))).toBe(body);
  });

  test("children move within their section, never out of it", () => {
    const blocks = parseBlocks(exampleBody(SMUGGLERS));
    const target = section(blocks, 2);
    const first = at(target.children, 0);
    const last = at(target.children, 2);

    const down = section(moveBy(blocks, first.id, 1), 2);
    expect(down.children.map((child) => child.id)).toEqual([
      at(target.children, 1).id,
      first.id,
      last.id,
    ]);
    // At the ends nothing happens — leaving the section is not part of this
    // slice (the UI disables the button, this is the guard behind it).
    expect(moveBy(blocks, first.id, -1)).toBe(blocks);
    expect(section(moveBy(blocks, last.id, 1), 2).children.map((c) => c.id)).toEqual(
      target.children.map((c) => c.id),
    );
  });

  test("moving the first block of the document is a no-op", () => {
    const blocks = parseBlocks(exampleBody(ARRIVAL));
    expect(moveBy(blocks, at(blocks, 0).id, -1)).toBe(blocks);
    expect(moveBy(blocks, at(blocks, blocks.length - 1).id, 1)).toBe(blocks);
  });

  test("removing a child only touches its own section", () => {
    const body = exampleBody(SMUGGLERS);
    const blocks = parseBlocks(body);
    const child = at(section(blocks, 2).children, 1);
    const next = removeAt(blocks, child.id);

    expect(section(next, 2).children).toHaveLength(2);
    expect(section(next, 3).children).toEqual(section(blocks, 3).children);
    expect(serializeBlocks(next)).not.toContain("die morschen Bretter");
    // The untouched second section is still in the file verbatim.
    expect(serializeBlocks(next)).toContain(section(blocks, 3).source ?? "");
  });

  test("removing a section takes its children with it", () => {
    const blocks = parseBlocks(exampleBody(SMUGGLERS));
    const target = section(blocks, 2);
    const next = removeAt(blocks, target.id);
    expect(next).toHaveLength(3);
    const markdown = serializeBlocks(next);
    expect(markdown).not.toContain("## If: sie geben zu");
    expect(markdown).not.toContain("die morschen Bretter");
  });

  test("removing the last block of a raw-only body leaves an empty draft", () => {
    const blocks = parseBlocks("> [!warning] unbekannt\n");
    expect(at(blocks, 0).type).toBe("raw");
    expect(removeAt(blocks, at(blocks, 0).id)).toEqual([]);
  });
});

describe("what blocks a save", () => {
  /** A section with one text child, ready to be typed into. */
  function withChild(text: string): { blocks: SceneBlock[]; childId: string } {
    const blocks = parseBlocks("## Flow\n\n## If: sie lügen\n\ndrin\n");
    const child = at(section(blocks, 1).children, 0);
    return { blocks: setBlockText(blocks, child.id, text), childId: child.id };
  }

  test("a clean list has nothing to say", () => {
    for (const rel of exampleFiles()) {
      expect(composerIssues(parseBlocks(exampleBody(rel)))).toEqual({});
    }
  });

  test("a `##` typed into a section's child is named at that child", () => {
    const { blocks, childId } = withChild("## Flow");
    const issues = composerIssues(blocks);
    expect(Object.keys(issues)).toEqual([childId]);
    expect(issues[childId]).toContain("beendet den Falls-Abschnitt");
    // …and it is a HINT: the text the DM typed is still there, unchanged.
    const child = at(section(blocks, 1).children, 0);
    if (child.type !== "text") throw new Error("expected a text block");
    expect(child.text).toBe("## Flow");
  });

  test("…because the next parse really does pull it out of the section", () => {
    const { blocks } = withChild("## Flow\n\nnoch mehr");
    // This is the damage the issue prevents: the composer shows one section
    // with one child, the file comes back with a heading and a paragraph
    // OUTSIDE the branch.
    const reparsed = parseBlocks(serializeBlocks(blocks));
    expect(reparsed.map((block) => block.type)).toEqual([
      "heading",
      "ifSection",
      "heading",
      "text",
    ]);
    const emptied = reparsed[1];
    if (emptied?.type !== "ifSection") throw new Error("expected an If-section");
    expect(emptied.children).toEqual([]);
  });

  test("a `#` counts as well, a `###` does not", () => {
    expect(Object.keys(composerIssues(withChild("# Kapitel").blocks))).toHaveLength(1);
    expect(composerIssues(withChild("### Detail").blocks)).toEqual({});
  });

  test("a `##` that is not a heading is not an issue", () => {
    // The parser's own reading decides — a fence, a blockquote and an indented
    // code block all hold their `##` harmlessly (README: the format degrades).
    expect(composerIssues(withChild("```md\n## Flow\n```").blocks)).toEqual({});
    expect(composerIssues(withChild("> [!note] x\n> ## keine Überschrift").blocks)).toEqual({});
    expect(composerIssues(withChild("Ein Absatz über ## Rauten.").blocks)).toEqual({});
  });

  test("a heading child that would end the section is named too", () => {
    const blocks = parseBlocks("## If: sie lügen\n\n### Detail\n");
    const child = at(section(blocks, 0).children, 0);
    // The picker never offers level 2 inside a section, but the regler shows a
    // level the FILE brought — the guard sits behind the UI, not in it.
    expect(composerIssues(setHeadingDepth(blocks, child.id, 2))).not.toEqual({});
    expect(composerIssues(setHeadingDepth(blocks, child.id, 4))).toEqual({});
  });

  test("a `##` at document level is a perfectly normal heading", () => {
    const blocks = parseBlocks("## Flow\n\nText\n");
    expect(composerIssues(setBlockText(blocks, at(blocks, 1).id, "## Noch eine"))).toEqual({});
    expect(composerIssues(insertAt(blocks, { index: 2 }, makeHeading(2, "Danach")))).toEqual({});
  });

  test("a fresh block inserted into a section is clean", () => {
    const blocks = parseBlocks("## If: sie lügen\n\ndrin\n");
    const target = section(blocks, 0);
    for (const option of newBlockOptions("section")) {
      const next = insertAt(blocks, { sectionId: target.id, index: 0 }, option.create());
      expect(composerIssues(next)).toEqual({});
    }
  });
});

describe("the type picker", () => {
  test("the document offers the six callouts, both plain blocks and a section", () => {
    expect(newBlockOptions("document").map((option) => option.label)).toEqual([
      "Vorlesetext",
      "Check",
      "Geheim",
      "Konsequenz",
      "Beute",
      "Notiz",
      "Überschrift",
      "Text",
      "Falls-Abschnitt",
    ]);
  });

  test("inside a section there is no nested section", () => {
    const options = newBlockOptions("section");
    expect(options.map((option) => option.key)).not.toContain("ifSection");
    expect(options).toHaveLength(8);
  });

  test("a new heading inside a section starts below the section's own level", () => {
    const heading = (scope: "document" | "section") => {
      const option = newBlockOptions(scope).find((candidate) => candidate.key === "heading");
      const block = option?.create();
      if (block?.type !== "heading") throw new Error("expected a heading option");
      return block.depth;
    };
    // `##` inside a section would END it (blocks.ts) and take everything below
    // it out of the branch.
    expect(heading("section")).toBe(3);
    expect(heading("document")).toBe(2);
    expect(headingDepths("section")).toEqual([3, 4, 5, 6]);
    expect(headingDepths("document")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("every option builds an empty block that serializes and parses back", () => {
    for (const scope of ["document", "section"] as const) {
      for (const option of newBlockOptions(scope)) {
        const block = option.create();
        const markdown = serializeBlocks([block]);
        expect(serializeBlocks(parseBlocks(markdown))).toBe(markdown);
      }
    }
  });

  test("an insert slot is identified by its list and its index", () => {
    expect(sameInsertAt({ index: 2 }, { index: 2 })).toBe(true);
    expect(sameInsertAt({ index: 2 }, { index: 3 })).toBe(false);
    expect(sameInsertAt({ sectionId: "blk1", index: 0 }, { index: 0 })).toBe(false);
    expect(sameInsertAt(undefined, { index: 0 })).toBe(false);
  });
});
