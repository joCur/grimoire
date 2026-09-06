// The composer's surface (issue #43, phase 2), rendered against the reference
// scenes — not against invented blocks: what the DM meets is whatever the
// phase-1 parser makes of the files in examples/.
//
// The checks are the ticket's acceptance criteria that a rendering can carry:
// every block is a card with the reading view's own type label, every card can
// be moved and deleted with a REAL BUTTON (AK 4 forbids drag-and-drop-only),
// If-section children get their own controls, the picker offers all types, and
// each block type gets the form its fields deserve.

import { parseMarkdown } from "@grimoire/shared";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  makeHeading,
  parseBlocks,
  type IfSectionBlock,
  type SceneBlock,
} from "@/lib/blocks";
import { composerIssues, setBlockText } from "@/lib/composer";

import {
  BlockCard,
  BlockComposer,
  BlockFields,
  BlockTypePicker,
  ComposerModeToggle,
  InsertSlot,
} from "./BlockComposer";

const EXAMPLES = new URL("../../../examples/", import.meta.url);

function exampleBlocks(rel: string): SceneBlock[] {
  // `rel` is an ADDRESS (issue #79); the committed fixture is still a file.
  const raw = readFileSync(new URL(`${rel}.md`, EXAMPLES), "utf8");
  return parseBlocks(parseMarkdown(raw, rel, 0).body);
}

const ARRIVAL = "beispiel/01-salzhafen/hafen/ankunft-leuchtturm";
const SMUGGLERS = "beispiel/01-salzhafen/hafen/von-schmugglern-erwischt";

function composer(blocks: SceneBlock[], issues: Record<string, string> = {}): string {
  return renderToStaticMarkup(
    <BlockComposer
      blocks={blocks}
      onChange={() => {}}
      idPrefix="body-scene"
      label="szene"
      issues={issues}
    />,
  );
}

function fields(block: SceneBlock, scope: "document" | "section" = "document"): string {
  return renderToStaticMarkup(
    <BlockFields
      block={block}
      scope={scope}
      idPrefix="body-scene"
      onText={() => {}}
      onDepth={() => {}}
    />,
  );
}

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function firstSection(blocks: SceneBlock[]): IfSectionBlock {
  const found = blocks.find((block): block is IfSectionBlock => block.type === "ifSection");
  if (found === undefined) throw new Error("expected an If-section");
  return found;
}

describe("the block list", () => {
  test("names every block of the reference scene in the reading view's words", () => {
    const html = composer(exampleBlocks(ARRIVAL));
    for (const label of ["Überschrift", "Text", "Vorlesetext", "Check", "Geheim", "Notiz"]) {
      expect(html).toContain(label);
    }
    // A collapsed card shows its own content, not the markdown markers.
    expect(html).toContain("Der Turm ragt schwarz");
    expect(html).not.toContain("&gt; [!readaloud]");
    // …and no form is open until the DM asks for one.
    expect(html).not.toContain("<textarea");
  });

  test("every card carries move and delete buttons, named by type and position", () => {
    const html = composer(exampleBlocks(ARRIVAL));
    expect(html).toContain('aria-label="Vorlesetext 3 nach oben"');
    expect(html).toContain('aria-label="Vorlesetext 3 nach unten"');
    expect(html).toContain('aria-label="Vorlesetext 3 bearbeiten"');
    expect(html).toContain('aria-label="Vorlesetext 3 löschen"');
    // AK 4: no drag-and-drop anywhere — the controls are buttons.
    expect(html).not.toContain("draggable");
  });

  test("the ends of the list have nothing to swap with", () => {
    const html = composer(exampleBlocks(ARRIVAL));
    expect(html).toContain('aria-label="Überschrift 1 nach oben" disabled');
    expect(html).toContain('aria-label="Notiz 6 nach unten" disabled');
    expect(html).not.toContain('aria-label="Überschrift 1 nach unten" disabled');
  });

  test("there is an insert slot before, between and after the blocks", () => {
    const blocks = exampleBlocks(ARRIVAL);
    const html = composer(blocks);
    expect(occurrences(html, 'aria-label="Block an Position')).toBe(blocks.length + 1);
    expect(html).toContain('aria-label="Block an Position 1 einfügen"');
    expect(html).toContain(`aria-label="Block an Position ${blocks.length + 1} einfügen"`);
  });

  test("an empty body invites the first block instead of showing nothing", () => {
    const html = composer([]);
    expect(html).toContain('aria-label="Block an Position 1 einfügen"');
    expect(html).toContain("Noch keine Blöcke");
  });

  test("an unknown callout stays a raw block and says which kind it was", () => {
    const html = composer(parseBlocks("> [!warning] Kein bekannter Typ\n"));
    expect(html).toContain("Roh-Block");
    expect(html).toContain("[!warning]");
    expect(html).toContain('aria-label="Roh-Block 1 bearbeiten"');
  });
});

describe("If-sections", () => {
  const blocks = exampleBlocks(SMUGGLERS);
  const html = composer(blocks);

  test("the section shows its condition and nests its children as cards", () => {
    expect(html).toContain("Falls-Abschnitt");
    expect(html).toContain("sie geben zu, für Jorna zu arbeiten");
    // The children of the first section: two text blocks and a note.
    expect(html).toContain("die morschen Bretter");
    expect(html).toContain('aria-label="Notiz 3 bearbeiten"');
  });

  test("children have their own insert slots and moves", () => {
    const children = firstSection(blocks).children;
    expect(html).toContain('aria-label="Block im Falls-Abschnitt an Position 1 einfügen"');
    expect(html).toContain(
      `aria-label="Block im Falls-Abschnitt an Position ${children.length + 1} einfügen"`,
    );
    // A child at the top of its section cannot move further up — moving out of
    // the section is not part of this slice.
    expect(html).toContain('aria-label="Text 1 nach oben" disabled');
  });
});

describe("the type picker", () => {
  test("offers all nine types at document level", () => {
    const html = renderToStaticMarkup(
      <BlockTypePicker scope="document" onPick={() => {}} onCancel={() => {}} />,
    );
    for (const label of [
      "Vorlesetext",
      "Check",
      "Geheim",
      "Konsequenz",
      "Beute",
      "Notiz",
      "Überschrift",
      "Text",
      "Falls-Abschnitt",
    ]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain("Block einfügen");
    expect(html).toContain('aria-label="Einfügen abbrechen"');
  });

  test("offers no nested section inside a section", () => {
    const html = renderToStaticMarkup(
      <BlockTypePicker scope="section" onPick={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain(">Vorlesetext</button>");
    expect(html).not.toContain(">Falls-Abschnitt</button>");
  });

  test("closed by default — the slot is a quiet plus, not a permanent panel", () => {
    expect(composer(exampleBlocks(ARRIVAL))).not.toContain("Block einfügen");
  });
});

describe("the per-block forms", () => {
  test("a callout gets one textarea with its text, markers stripped", () => {
    const readaloud = exampleBlocks(ARRIVAL)[2];
    if (readaloud === undefined) throw new Error("expected the readaloud callout");
    const html = fields(readaloud);
    expect(html).toContain('aria-label="Inhalt: Vorlesetext"');
    expect(html).toContain("Der Turm ragt schwarz");
    expect(html).not.toContain("&gt;");
    // The kind is fixed — a callout cannot be turned into another type here.
    expect(html).not.toContain("<select");
  });

  test("a heading gets its level and its text", () => {
    const html = fields(makeHeading(2, "Flow"));
    expect(html).toContain('aria-label="Ebene der Überschrift"');
    expect(html).toContain(">Ebene 1</option>");
    expect(html).toContain(">Ebene 6</option>");
    expect(html).toContain('aria-label="Text der Überschrift"');
    expect(html).toContain('value="Flow"');
  });

  test("inside a section a heading cannot become one that ends the section", () => {
    const html = fields(makeHeading(3, "Danach"), "section");
    expect(html).toContain(">Ebene 3</option>");
    expect(html).not.toContain(">Ebene 2</option>");
  });

  test("a level the file already carries stays selectable", () => {
    // A hand-written `## Flow` inside a section cannot exist (it would end the
    // section), but a `# Titel` at document level and any other hand-written
    // level must never silently jump to another value.
    const html = fields(makeHeading(2, "Flow"), "section");
    expect(occurrences(html, ">Ebene 2</option>")).toBe(1);
    expect(html).toContain('<select id="body-scene-');
  });

  test("a section's form is its condition", () => {
    const html = fields(firstSection(exampleBlocks(SMUGGLERS)));
    expect(html).toContain('aria-label="Bedingung des Falls-Abschnitts"');
    expect(html).toContain("sie geben zu, für Jorna zu arbeiten");
    expect(html).toContain("## If:");
  });

  test("a text block is edited as markdown, a raw block with its markers", () => {
    const text = parseBlocks("- eins\n- zwei\n")[0];
    const raw = parseBlocks("> Nur ein Zitat\n")[0];
    if (text === undefined || raw === undefined) throw new Error("expected two blocks");

    const textHtml = fields(text);
    expect(textHtml).toContain('aria-label="Inhalt: Text"');
    expect(textHtml).toContain("- eins");

    const rawHtml = fields(raw);
    expect(rawHtml).toContain('aria-label="Inhalt: Roh-Block"');
    expect(rawHtml).toContain("&gt; Nur ein Zitat");
    expect(rawHtml).toContain("font-mono");
    expect(rawHtml).toContain("Roh-Markdown mit Markern");
  });
});

describe("a block that would break the file", () => {
  /** The smugglers scene with a `##` typed into the first section's first child. */
  function escaped(): { blocks: SceneBlock[]; issues: Record<string, string> } {
    const blocks = exampleBlocks(SMUGGLERS);
    const child = firstSection(blocks).children[0];
    if (child === undefined) throw new Error("expected a child");
    const next = setBlockText(blocks, child.id, "## Flow");
    return { blocks: next, issues: composerIssues(next) };
  }

  test("the hint stands at the offending card, not somewhere in the page", () => {
    const { blocks, issues } = escaped();
    const html = composer(blocks, issues);
    expect(html).toContain("beendet den Falls-Abschnitt");
    // Exactly once — one card owns the problem.
    expect(occurrences(html, "beendet den Falls-Abschnitt")).toBe(1);
    // …and it is announced, like the properties form's field errors.
    expect(html).toContain('aria-live="polite"');
  });

  test("without issues no card carries a hint", () => {
    expect(composer(exampleBlocks(SMUGGLERS))).not.toContain("beendet den Falls-Abschnitt");
  });
});

describe("re-render discipline", () => {
  // A scene is 10–30 blocks and every keystroke hands down a new list. The
  // cards must therefore be able to bail out, which needs two things: a memo
  // boundary, and props that do not change for an untouched block. Both are
  // checkable without a DOM — a render-count probe would need one.
  test("the card and the insert slot are memo boundaries", () => {
    expect((BlockCard as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
    expect((InsertSlot as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  test("a keystroke replaces exactly one block object", () => {
    const blocks = exampleBlocks(ARRIVAL);
    const target = blocks[2];
    if (target === undefined) throw new Error("expected a block");
    const next = setBlockText(blocks, target.id, "Der Turm steht still.");
    // React's shallow compare sees the same `block` prop for every other card,
    // so only the edited one re-renders (the callbacks are stable, the rest of
    // a card's props are booleans and strings).
    expect(next).toHaveLength(blocks.length);
    for (let i = 0; i < blocks.length; i++) {
      if (i === 2) expect(next[i]).not.toBe(blocks[i]);
      else expect(next[i]).toBe(blocks[i]);
    }
  });

  test("typing in a section's child re-creates that child and its section only", () => {
    const blocks = exampleBlocks(SMUGGLERS);
    const section = firstSection(blocks);
    const child = section.children[1];
    if (child === undefined) throw new Error("expected a child");
    const next = setBlockText(blocks, child.id, "- neu");

    expect(next[0]).toBe(blocks[0]);
    expect(next[1]).toBe(blocks[1]);
    // The section holds the changed children, so its card re-renders …
    expect(next[2]).not.toBe(blocks[2]);
    // … while its untouched children and the second section do not.
    const grown = next[2];
    if (grown?.type !== "ifSection") throw new Error("expected an If-section");
    expect(grown.children[0]).toBe(section.children[0]);
    expect(grown.children[1]).not.toBe(section.children[1]);
    expect(grown.children[2]).toBe(section.children[2]);
    expect(next[3]).toBe(blocks[3]);
  });
});

describe("the mode toggle", () => {
  test("Blöcke is pressed while the composer is on screen", () => {
    const html = renderToStaticMarkup(
      <ComposerModeToggle mode="blocks" onModeChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Editiermodus"');
    expect(html).toContain('aria-pressed="true">Blöcke</button>');
    expect(html).toContain('aria-pressed="false">Roh</button>');
  });

  test("…and Roh is pressed on the fallback surface", () => {
    const html = renderToStaticMarkup(<ComposerModeToggle mode="raw" onModeChange={() => {}} />);
    expect(html).toContain('aria-pressed="false">Blöcke</button>');
    expect(html).toContain('aria-pressed="true">Roh</button>');
  });
});
