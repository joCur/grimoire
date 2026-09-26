// The composer's surface (phase 2), rendered against the reference scenes —
// not against invented blocks: what the DM meets is whatever the phase-1
// parser makes of the fixture bodies.
//
// The checks are the acceptance criteria that a rendering can carry: every
// block is a card with the reading view's own type label, every card can be
// moved and deleted with a REAL BUTTON (drag-and-drop-only is forbidden),
// If-section children get their own controls, the picker offers all types, and
// each block type gets the form its fields deserve.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  makeHeading,
  parseBlocks,
  type IfSectionBlock,
  type SceneBlock,
} from "@/lib/blocks";
import { translator } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages";
import { composerIssues, setBlockText } from "@/lib/composer";

import {
  BlockCard,
  BlockComposer,
  BlockFields,
  BlockTypePicker,
  ComposerModeToggle,
  InsertSlot,
} from "./BlockComposer";

const FIXTURES = new URL("../../../fixtures/beispiel/", import.meta.url);

/** The blocks the phase-1 parser makes of a fixture scene's body. */
function fixtureBlocks(name: string): SceneBlock[] {
  const { body } = JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")) as { body: string };
  return parseBlocks(body);
}

// Rendered outside a provider, the composer speaks the default language.
const t = translator("de");

/** The `aria-label` attribute a catalog key renders to. */
function aria(key: MessageKey, params?: Record<string, string | number>): string {
  return `aria-label="${t(key, params)}"`;
}

/** The accessible name of a card: its type label plus its position. */
function card(labelKey: MessageKey, position: number): string {
  return t("composer.card.name", { label: t(labelKey), position });
}

const ARRIVAL = "scenes/lighthouse-arrival.json";
const SMUGGLERS = "scenes/smuggler-captured.json";

function composer(blocks: SceneBlock[], issues: Record<string, string> = {}): string {
  return renderToStaticMarkup(
    <BlockComposer
      blocks={blocks}
      onChange={() => {}}
      idPrefix="body-scene"
      label="scene"
      issues={issues}
    />,
  );
}

function fields(block: SceneBlock, scope: "body" | "section" = "body"): string {
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

/** One option of the heading level select. */
function level(depth: number): string {
  return `>${t("composer.heading.level", { depth })}</option>`;
}

function firstSection(blocks: SceneBlock[]): IfSectionBlock {
  const found = blocks.find((block): block is IfSectionBlock => block.type === "ifSection");
  if (found === undefined) throw new Error("expected an If-section");
  return found;
}

describe("the block list", () => {
  test("names every block of the reference scene in the reading view's words", () => {
    const html = composer(fixtureBlocks(ARRIVAL));
    for (const key of [
      "composer.blockType.heading",
      "composer.blockType.text",
      "markdown.callout.readaloud",
      "markdown.callout.check",
      "markdown.callout.secret",
      "markdown.callout.note",
    ] as const) {
      expect(html).toContain(t(key));
    }
    // A collapsed card shows its own content (the seed scene's text), not the markdown markers.
    expect(html).toContain("Der Turm ragt schwarz");
    expect(html).not.toContain("&gt; [!readaloud]");
    // …and no form is open until the DM asks for one.
    expect(html).not.toContain("<textarea");
  });

  test("every card carries move and delete buttons, named by type and position", () => {
    const html = composer(fixtureBlocks(ARRIVAL));
    const name = card("markdown.callout.readaloud", 3);
    expect(html).toContain(aria("composer.card.moveUp.aria", { name }));
    expect(html).toContain(aria("composer.card.moveDown.aria", { name }));
    expect(html).toContain(aria("composer.card.edit.aria", { name }));
    expect(html).toContain(aria("composer.card.delete.aria", { name }));
    // No drag-and-drop anywhere — the controls are buttons.
    expect(html).not.toContain("draggable");
  });

  test("the ends of the list have nothing to swap with", () => {
    const html = composer(fixtureBlocks(ARRIVAL));
    const heading = card("composer.blockType.heading", 1);
    const note = card("markdown.callout.note", 6);
    expect(html).toContain(`${aria("composer.card.moveUp.aria", { name: heading })} disabled`);
    expect(html).toContain(`${aria("composer.card.moveDown.aria", { name: note })} disabled`);
    expect(html).not.toContain(`${aria("composer.card.moveDown.aria", { name: heading })} disabled`);
  });

  test("there is an insert slot before, between and after the blocks", () => {
    const blocks = fixtureBlocks(ARRIVAL);
    const html = composer(blocks);
    const slots = Array.from({ length: blocks.length + 1 }, (_, i) =>
      aria("composer.insert.aria", { position: i + 1 }),
    );
    expect(slots.reduce((sum, slot) => sum + occurrences(html, slot), 0)).toBe(blocks.length + 1);
    expect(html).toContain(aria("composer.insert.aria", { position: 1 }));
    expect(html).toContain(aria("composer.insert.aria", { position: blocks.length + 1 }));
    expect(html).not.toContain(aria("composer.insert.aria", { position: blocks.length + 2 }));
  });

  test("an empty body invites the first block instead of showing nothing", () => {
    const html = composer([]);
    expect(html).toContain(aria("composer.insert.aria", { position: 1 }));
    expect(html).toContain(t("composer.empty"));
  });

  test("an unknown callout stays a raw block and says which kind it was", () => {
    const html = composer(parseBlocks("> [!warning] Not a known type\n"));
    expect(html).toContain(t("composer.blockType.markdown"));
    expect(html).toContain("[!warning]");
    expect(html).toContain(
      aria("composer.card.edit.aria", { name: card("composer.blockType.markdown", 1) }),
    );
  });
});

describe("If-sections", () => {
  const blocks = fixtureBlocks(SMUGGLERS);
  const html = composer(blocks);

  test("the section shows its condition and nests its children as cards", () => {
    expect(html).toContain(t("composer.blockType.ifSection"));
    // The condition and the children's text come from the seed scene.
    expect(html).toContain("sie geben zu, für Jorna zu arbeiten");
    // The children of the first section: two text blocks and a note.
    expect(html).toContain("die morschen Bretter");
    expect(html).toContain(
      aria("composer.card.edit.aria", { name: card("markdown.callout.note", 3) }),
    );
  });

  test("children have their own insert slots and moves", () => {
    const children = firstSection(blocks).children;
    expect(html).toContain(aria("composer.insert.section.aria", { position: 1 }));
    expect(html).toContain(aria("composer.insert.section.aria", { position: children.length + 1 }));
    // A child at the top of its section cannot move further up — moving out of
    // the section is not part of this slice.
    expect(html).toContain(
      `${aria("composer.card.moveUp.aria", { name: card("composer.blockType.text", 1) })} disabled`,
    );
  });
});

describe("the type picker", () => {
  test("offers all nine types at document level", () => {
    const html = renderToStaticMarkup(
      <BlockTypePicker scope="body" onPick={() => {}} onCancel={() => {}} />,
    );
    for (const key of [
      "markdown.callout.readaloud",
      "markdown.callout.check",
      "markdown.callout.secret",
      "markdown.callout.outcome",
      "markdown.callout.loot",
      "markdown.callout.note",
      "composer.blockType.heading",
      "composer.blockType.text",
      "composer.blockType.ifSection",
    ] as const) {
      expect(html).toContain(`>${t(key)}</button>`);
    }
    expect(html).toContain(t("composer.picker.title"));
    expect(html).toContain(aria("composer.picker.cancel.aria"));
  });

  test("offers no nested section inside a section", () => {
    const html = renderToStaticMarkup(
      <BlockTypePicker scope="section" onPick={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain(`>${t("markdown.callout.readaloud")}</button>`);
    expect(html).not.toContain(`>${t("composer.blockType.ifSection")}</button>`);
  });

  test("closed by default — the slot is a quiet plus, not a permanent panel", () => {
    expect(composer(fixtureBlocks(ARRIVAL))).not.toContain(t("composer.picker.title"));
  });
});

describe("the per-block forms", () => {
  test("a callout gets one textarea with its text, markers stripped", () => {
    const readaloud = fixtureBlocks(ARRIVAL)[2];
    if (readaloud === undefined) throw new Error("expected the readaloud callout");
    const html = fields(readaloud);
    expect(html).toContain(
      aria("composer.block.content.aria", { label: t("markdown.callout.readaloud") }),
    );
    expect(html).toContain("Der Turm ragt schwarz");
    expect(html).not.toContain("&gt;");
    // The kind is fixed — a callout cannot be turned into another type here.
    expect(html).not.toContain("<select");
  });

  test("a heading gets its level and its text", () => {
    const html = fields(makeHeading(2, "Flow"));
    expect(html).toContain(aria("composer.heading.level.aria"));
    expect(html).toContain(level(1));
    expect(html).toContain(level(6));
    expect(html).toContain(aria("composer.heading.text.aria"));
    expect(html).toContain('value="Flow"');
  });

  test("inside a section a heading cannot become one that ends the section", () => {
    const html = fields(makeHeading(3, "After"), "section");
    expect(html).toContain(level(3));
    expect(html).not.toContain(level(2));
  });

  test("a level the body already carries stays selectable", () => {
    // A hand-written `## Flow` inside a section cannot exist (it would end the
    // section), but a `# Title` at document level and any other hand-written
    // level must never silently jump to another value.
    const html = fields(makeHeading(2, "Flow"), "section");
    expect(occurrences(html, level(2))).toBe(1);
    expect(html).toContain('<select id="body-scene-');
  });

  test("a section's form is its condition", () => {
    const html = fields(firstSection(fixtureBlocks(SMUGGLERS)));
    expect(html).toContain(aria("composer.ifSection.condition.aria"));
    expect(html).toContain("sie geben zu, für Jorna zu arbeiten");
    expect(html).toContain("## If:");
  });

  test("a text block is edited as markdown, a raw block with its markers", () => {
    const text = parseBlocks("- one\n- two\n")[0];
    const raw = parseBlocks("> Just a quote\n")[0];
    if (text === undefined || raw === undefined) throw new Error("expected two blocks");

    const textHtml = fields(text);
    expect(textHtml).toContain(
      aria("composer.block.content.aria", { label: t("composer.blockType.text") }),
    );
    expect(textHtml).toContain("- one");

    const rawHtml = fields(raw);
    expect(rawHtml).toContain(
      aria("composer.block.content.aria", { label: t("composer.blockType.markdown") }),
    );
    expect(rawHtml).toContain("&gt; Just a quote");
    expect(rawHtml).toContain("font-mono");
    expect(rawHtml).toContain(t("composer.markdown.hint"));
  });
});

describe("a block that would break the body", () => {
  /** The smugglers scene with a `##` typed into the first section's first child. */
  function escaped(): { blocks: SceneBlock[]; issues: Record<string, string> } {
    const blocks = fixtureBlocks(SMUGGLERS);
    const child = firstSection(blocks).children[0];
    if (child === undefined) throw new Error("expected a child");
    const next = setBlockText(blocks, child.id, "## Flow");
    return { blocks: next, issues: composerIssues(next, t) };
  }

  test("the hint stands at the offending card, not somewhere in the page", () => {
    const { blocks, issues } = escaped();
    const html = composer(blocks, issues);
    const hint = t("composer.issue.sectionEscape");
    expect(html).toContain(hint);
    // Exactly once — one card owns the problem.
    expect(occurrences(html, hint)).toBe(1);
    // …and it is announced, like the properties form's field errors.
    expect(html).toContain('aria-live="polite"');
  });

  test("without issues no card carries a hint", () => {
    expect(composer(fixtureBlocks(SMUGGLERS))).not.toContain(t("composer.issue.sectionEscape"));
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
    const blocks = fixtureBlocks(ARRIVAL);
    const target = blocks[2];
    if (target === undefined) throw new Error("expected a block");
    const next = setBlockText(blocks, target.id, "The tower stands still.");
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
    const blocks = fixtureBlocks(SMUGGLERS);
    const section = firstSection(blocks);
    const child = section.children[1];
    if (child === undefined) throw new Error("expected a child");
    const next = setBlockText(blocks, child.id, "- new");

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
  test("blocks is pressed while the composer is on screen", () => {
    const html = renderToStaticMarkup(
      <ComposerModeToggle mode="blocks" onModeChange={() => {}} />,
    );
    expect(html).toContain(aria("composer.mode.aria"));
    expect(html).toContain(`aria-pressed="true">${t("composer.mode.blocks")}</button>`);
    expect(html).toContain(`aria-pressed="false">${t("composer.mode.markdown")}</button>`);
  });

  test("…and Markdown is pressed on the fallback surface", () => {
    const html = renderToStaticMarkup(<ComposerModeToggle mode="markdown" onModeChange={() => {}} />);
    expect(html).toContain(`aria-pressed="false">${t("composer.mode.blocks")}</button>`);
    expect(html).toContain(`aria-pressed="true">${t("composer.mode.markdown")}</button>`);
  });
});
