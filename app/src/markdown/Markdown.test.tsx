// Render tests for the markdown pipeline (react-dom/server — no DOM
// needed): callout anatomy, read-aloud without label row, both initial
// states of the if-sections, and the degrade paths.
//
// At the end of this file: GFM TABLES and the four GFM extensions that stay
// off. Rendered HTML rather than mdast, because the question is
// what the DM sees: a table has to become a real `<table>` — in body text, in
// every callout and inside an `## If:` branch — while `- [x]`, `~~wort~~`, a
// bare URL and a `[^1]` footnote have to stay the literal text they are today.
// That second half is the load-bearing one: `- [x]` is the INBOX's check-off
// syntax (README), and a checkbox rendered from it would be a control that
// writes nothing.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { CALLOUT_KINDS } from "@grimoire/shared/types";

import { Markdown } from "./Markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
}

/** The live scene column: the same pipeline with its branches folded. */
function renderCollapsed(markdown: string): string {
  return renderToStaticMarkup(<Markdown ifSections="collapsed">{markdown}</Markdown>);
}

/** An opened branch in the rendered markup — and how many of them there are. */
const OPEN_DETAILS = /<details[^>]*\sopen/;

function openBranches(html: string): number {
  return [...html.matchAll(/<details[^>]*\sopen/g)].length;
}

/** The reference fixtures CLAUDE.md names for renderer changes, body only. */
function fixtureBody(name: string): string {
  const raw = readFileSync(new URL(`../../../fixtures/beispiel/${name}`, import.meta.url), "utf8");
  return (JSON.parse(raw) as { body: string }).body;
}

const FIXTURES = [
  "scenes/lighthouse-arrival.json",
  "scenes/smuggler-captured.json",
  "npcs/fenn.json",
];

describe("Markdown pipeline rendering", () => {
  test("check callout renders label row and tagged section", () => {
    const html = render("> [!check] Wisdom (Perception) DC 13.");
    expect(html).toContain('data-callout="check"');
    expect(html).toContain(">Probe<");
    expect(html).toContain("Wisdom (Perception) DC 13.");
  });

  test("callout labels match the design reference", () => {
    expect(render("> [!secret] x")).toContain(">Geheim<");
    expect(render("> [!outcome] x")).toContain(">Ergebnis<");
    expect(render("> [!loot] x")).toContain(">Beute<");
    expect(render("> [!note] x")).toContain(">Notiz<");
  });

  test("read-aloud has no label row but a copy button", () => {
    const html = render("> [!readaloud] Der Turm ragt schwarz auf.");
    expect(html).toContain('data-callout="readaloud"');
    expect(html).not.toContain("Vorlesen<"); // no label row anymore
    expect(html).toContain("Kopieren");
    expect(html).toContain("Der Turm ragt schwarz auf.");
  });

  test("if-section renders as details that are open by default", () => {
    const html = render("## If: sie lügen\n\nInhalt.");
    expect(html).toContain("<details");
    expect(html).toContain(" open");
    expect(html).toContain("Falls:");
    expect(html).toContain("sie lügen");
    expect(html).toContain("Inhalt.");
  });

  test("the live column starts every if-section collapsed", () => {
    const html = renderCollapsed("## If: sie lügen\n\nInhalt.\n\n## If: sie schweigen\n\nAnderes.");
    // Two branches, neither of them unfolded. That the attribute is OMITTED
    // rather than passed as `open={false}` is what keeps the element
    // uncontrolled (Markdown.tsx) — the behaviour following from it, an open
    // branch surviving a re-render of the column, is an E2E assertion.
    expect([...html.matchAll(/data-if-section="/g)]).toHaveLength(2);
    expect(html).not.toMatch(OPEN_DETAILS);
    expect(html).not.toContain("open=");
    // The Falls row is there, and so is the content — just not unfolded.
    expect(html).toContain("Falls:");
    expect(html).toContain("sie lügen");
    expect(html).toContain("Inhalt.");
    expect(html).toContain("Anderes.");
  });

  test("the initial state is the view's, not the text's", () => {
    // The SAME reference scene, rendered twice: the live column folds its two
    // branches, every other surface opens them. Nothing in the body differs.
    const body = fixtureBody("scenes/smuggler-captured.json");
    expect(openBranches(render(body))).toBe(2);
    expect(renderCollapsed(body)).not.toMatch(OPEN_DETAILS);
    // Everything else the scene carries is untouched by the choice.
    expect([...renderCollapsed(body).matchAll(/data-callout="/g)]).toHaveLength(3);
    expect(renderCollapsed(body)).toContain("Falls:");
  });

  test("unknown callout kind degrades to a plain blockquote", () => {
    const html = render("> [!homebrew] Bleibt einfach Text.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("[!homebrew] Bleibt einfach Text.");
    expect(html).not.toContain("data-callout");
  });

  test("unknown headings render as normal text (no section wrapping)", () => {
    const html = render("## Ganz normale Überschrift\n\nText.");
    expect(html).toContain("<h2>Ganz normale Überschrift</h2>");
    expect(html).not.toContain("<details");
  });
});

// Raw HTML is dropped instead of printed (skipHtml): a `<!-- … -->` hint in a
// body would otherwise show up as visible text.
describe("HTML in the body", () => {
  test("an HTML comment is invisible", () => {
    const html = render("## Notizen\n\n<!-- wird von der App im Review-Schritt befüllt -->\n");
    expect(html).toContain("<h2>Notizen</h2>");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("wird von der App");
  });

  test("an inline comment leaves the surrounding sentence intact", () => {
    const html = render("Ein Satz <!-- Notiz --> mit Kommentar.\n");
    expect(html).not.toContain("Notiz");
    expect(html).toContain("Ein Satz");
    expect(html).toContain("mit Kommentar.");
  });

  test("the reference fixtures render exactly as before — comments are the only loss", () => {
    // The dropped comment leaves its surrounding blank lines behind as text,
    // so whitespace is collapsed before comparing; every element and every
    // visible character must be identical.
    const normalize = (html: string): string =>
      html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
    for (const rel of FIXTURES) {
      const body = fixtureBody(rel);
      const html = render(body);
      // Adding a comment anywhere changes NOTHING in the output …
      expect(normalize(render(`${body}\n\n<!-- ein Kommentar -->\n`))).toBe(normalize(html));
      // … and everything the format promises is still there.
      expect(html).not.toContain("<!--");
      expect(html).toContain("md-body");
    }
  });

  test("callouts and if-sections of the scene fixtures survive untouched", () => {
    const smugglers = render(fixtureBody("scenes/smuggler-captured.json"));
    expect([...smugglers.matchAll(/data-callout="/g)]).toHaveLength(3);
    expect([...smugglers.matchAll(/data-if-section="/g)]).toHaveLength(2);
    expect(smugglers).toContain("Falls:");

    const lighthouse = render(fixtureBody("scenes/lighthouse-arrival.json"));
    expect(lighthouse).toContain('data-callout="readaloud"');
    expect(lighthouse).toContain('data-callout="check"');
    // This fixture carries a W6 table in the `[!note]`.
    // Everything above is unchanged; this is the intended difference.
    expect([...lighthouse.matchAll(/data-callout="/g)]).toHaveLength(4);
    expect([...lighthouse.matchAll(/<table/g)]).toHaveLength(1);
    expect(lighthouse).toContain("Eine Laterne, das Glas rußgeschwärzt");
  });
});

// --- tables, and the GFM that stays off -------------------------------------

const W6 = [
  "| W6 | Was treibt in der Bucht |",
  "| --- | --- |",
  "| 1 | Ein leeres Fass |",
  "| 2 | Ein Ruder mit Kerben |",
].join("\n");

describe("tables", () => {
  test("a pipe table in the body becomes a real table", () => {
    const html = render(W6);
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th");
    expect(html).toContain("Was treibt in der Bucht");
    expect(html).toContain("Ein Ruder mit Kerben");
  });

  test("the table sits in its own horizontal scroll box, not on the page", () => {
    // AK 2: at 390px the TABLE scrolls. The box is the mechanism.
    const html = render(W6);
    expect(html).toContain('class="md-table-scroll"');
  });

  test("the box is only a focusable region once it really overflows", () => {
    // Nothing has been measured at render time, so the box is plain markup:
    // the tab stop and the landmark are added by the layout effect, and only
    // while `scrollWidth > clientWidth`. A table that fits is not a control.
    // The overflowing case is an E2E assertion (critical path 2, 390px).
    const html = render(W6);
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain('tabindex="0"');
    expect(html).not.toContain('aria-label="Tabelle"');
  });

  test.each([...CALLOUT_KINDS])("a table inside [!%s] renders as a table", (kind) => {
    const quoted = W6.split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const html = render(`> [!${kind}] Zufallstabelle\n>\n${quoted}`);
    expect(html).toContain(`data-callout="${kind}"`);
    expect(html).toContain("<table>");
    expect(html).toContain("Ein leeres Fass");
  });

  test("a table inside an `## If:` branch renders as a table", () => {
    const html = render(`## If: sie würfeln auf der Tabelle\n\n${W6}\n`);
    expect(html).toContain("data-if-section");
    expect(html).toContain("<table>");
  });

  test("`[[slug]]` in a cell degrades exactly like one in prose", () => {
    // The Grimoire pass walks the tree the table pass produced, so a cell is
    // not a blind spot: an unresolved reference shows its literal source here
    // just as it does in a paragraph (see remark-grimoire.test.ts for the
    // mdast side, where the cell's reference is marked for resolution).
    const cell = render("| Wer |\n| --- |\n| [[jorna]] |");
    expect(cell).toContain("[[jorna]]");
    expect(cell).toContain("<td>");
  });
});

describe("the rest of GFM stays text", () => {
  test("a task list stays a plain list — no checkbox (inbox syntax)", () => {
    const html = render("- [x] erledigt\n- [ ] offen\n");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("checkbox");
    expect(html).toContain("[x] erledigt");
    expect(html).toContain("[ ] offen");
  });

  test("strikethrough stays text", () => {
    const html = render("Der ~~alte~~ neue Turm.\n");
    expect(html).not.toContain("<del");
    expect(html).toContain("~~alte~~");
  });

  test("a bare URL is not autolinked and a footnote marker stays text", () => {
    const html = render("Siehe www.example.com und die Fußnote[^1].\n");
    expect(html).not.toContain("<a ");
    expect(html).toContain("www.example.com");
    expect(html).toContain("[^1]");
  });
});
