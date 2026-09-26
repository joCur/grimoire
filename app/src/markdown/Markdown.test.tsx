// Render tests for the markdown pipeline (react-dom/server — no DOM
// needed): callout anatomy, read-aloud without label row, both initial
// states of the if-sections, and the degrade paths.
//
// At the end of this file: GFM TABLES and the four GFM extensions that stay
// off. Rendered HTML rather than mdast, because the question is
// what the DM sees: a table has to become a real `<table>` — in body text, in
// every callout and inside an `## If:` branch — while `- [x]`, `~~word~~`, a
// bare URL and a `[^1]` footnote have to stay the literal text they are today.
// That second half is the load-bearing one: `- [x]` is the INBOX's check-off
// syntax (README), and a checkbox rendered from it would be a control that
// writes nothing.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { CALLOUT_KINDS } from "@grimoire/shared/callouts";

import { translator } from "@/i18n/format";

import { Markdown } from "./Markdown";

/** Without a provider the catalog answers in the primary language. */
const t = translator("de");

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
    expect(html).toContain(`>${t("markdown.callout.check")}<`);
    expect(html).toContain("Wisdom (Perception) DC 13.");
  });

  test("callout labels match the design reference", () => {
    for (const kind of ["secret", "outcome", "loot", "note"] as const) {
      expect(render(`> [!${kind}] x`)).toContain(`>${t(`markdown.callout.${kind}`)}<`);
    }
  });

  test("read-aloud has no label row but a copy button", () => {
    const html = render("> [!readaloud] The tower rises black.");
    expect(html).toContain('data-callout="readaloud"');
    expect(html).not.toContain(`>${t("markdown.callout.readaloud")}<`); // no label row
    expect(html).toContain(t("markdown.readaloud.copy"));
    expect(html).toContain("The tower rises black.");
  });

  test("if-section renders as details that are open by default", () => {
    const html = render("## If: they lie\n\nContent.");
    expect(html).toContain("<details");
    expect(html).toContain(" open");
    expect(html).toContain(t("markdown.ifSection.prefix"));
    expect(html).toContain("they lie");
    expect(html).toContain("Content.");
  });

  test("the live column starts every if-section collapsed", () => {
    const html = renderCollapsed("## If: they lie\n\nContent.\n\n## If: they stay silent\n\nOther.");
    // Two branches, neither of them unfolded. That the attribute is OMITTED
    // rather than passed as `open={false}` is what keeps the element
    // uncontrolled (Markdown.tsx) — the behaviour following from it, an open
    // branch surviving a re-render of the column, is an E2E assertion.
    expect([...html.matchAll(/data-if-section="/g)]).toHaveLength(2);
    expect(html).not.toMatch(OPEN_DETAILS);
    expect(html).not.toContain("open=");
    // The summary row is there, and so is the content — just not unfolded.
    expect(html).toContain(t("markdown.ifSection.prefix"));
    expect(html).toContain("they lie");
    expect(html).toContain("Content.");
    expect(html).toContain("Other.");
  });

  test("the initial state is the view's, not the text's", () => {
    // The SAME reference scene, rendered twice: the live column folds its two
    // branches, every other surface opens them. Nothing in the body differs.
    const body = fixtureBody("scenes/smuggler-captured.json");
    expect(openBranches(render(body))).toBe(2);
    expect(renderCollapsed(body)).not.toMatch(OPEN_DETAILS);
    // Everything else the scene carries is untouched by the choice.
    expect([...renderCollapsed(body).matchAll(/data-callout="/g)]).toHaveLength(3);
    expect(renderCollapsed(body)).toContain(t("markdown.ifSection.prefix"));
  });

  test("unknown callout kind degrades to a plain blockquote", () => {
    const html = render("> [!homebrew] Simply stays text.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("[!homebrew] Simply stays text.");
    expect(html).not.toContain("data-callout");
  });

  test("unknown headings render as normal text (no section wrapping)", () => {
    const html = render("## A perfectly ordinary heading\n\nText.");
    expect(html).toContain("<h2>A perfectly ordinary heading</h2>");
    expect(html).not.toContain("<details");
  });
});

// Raw HTML is dropped instead of printed (skipHtml): a `<!-- … -->` hint in a
// body would otherwise show up as visible text.
describe("HTML in the body", () => {
  test("an HTML comment is invisible", () => {
    const html = render("## Notes\n\n<!-- filled in by the app during review -->\n");
    expect(html).toContain("<h2>Notes</h2>");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("filled in by the app");
  });

  test("an inline comment leaves the surrounding sentence intact", () => {
    const html = render("A sentence <!-- remark --> with a comment.\n");
    expect(html).not.toContain("remark");
    expect(html).toContain("A sentence");
    expect(html).toContain("with a comment.");
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
      expect(normalize(render(`${body}\n\n<!-- a comment -->\n`))).toBe(normalize(html));
      // … and everything the format promises is still there.
      expect(html).not.toContain("<!--");
      expect(html).toContain("md-body");
    }
  });

  test("callouts and if-sections of the scene fixtures survive untouched", () => {
    const smugglers = render(fixtureBody("scenes/smuggler-captured.json"));
    expect([...smugglers.matchAll(/data-callout="/g)]).toHaveLength(3);
    expect([...smugglers.matchAll(/data-if-section="/g)]).toHaveLength(2);
    expect(smugglers).toContain(t("markdown.ifSection.prefix"));

    const lighthouse = render(fixtureBody("scenes/lighthouse-arrival.json"));
    expect(lighthouse).toContain('data-callout="readaloud"');
    expect(lighthouse).toContain('data-callout="check"');
    // This fixture carries a die table in the `[!note]`.
    expect([...lighthouse.matchAll(/data-callout="/g)]).toHaveLength(4);
    expect([...lighthouse.matchAll(/<table/g)]).toHaveLength(1);
    expect(lighthouse).toContain("Eine Laterne, das Glas rußgeschwärzt");
  });
});

// --- tables, and the GFM that stays off -------------------------------------

const D6 = [
  "| d6 | What drifts in the bay |",
  "| --- | --- |",
  "| 1 | An empty barrel |",
  "| 2 | A notched oar |",
].join("\n");

describe("tables", () => {
  test("a pipe table in the body becomes a real table", () => {
    const html = render(D6);
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th");
    expect(html).toContain("What drifts in the bay");
    expect(html).toContain("A notched oar");
  });

  test("the table sits in its own horizontal scroll box, not on the page", () => {
    // At 390px the TABLE scrolls, not the page. The box is the mechanism.
    const html = render(D6);
    expect(html).toContain('class="md-table-scroll"');
  });

  test("the box is only a focusable region once it really overflows", () => {
    // Nothing has been measured at render time, so the box is plain markup:
    // the tab stop and the landmark are added by the layout effect, and only
    // while `scrollWidth > clientWidth`. A table that fits is not a control.
    // The overflowing case is an E2E assertion (critical path 2, 390px).
    const html = render(D6);
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain('tabindex="0"');
    expect(html).not.toContain(`aria-label="${t("markdown.table.aria")}"`);
  });

  test.each([...CALLOUT_KINDS])("a table inside [!%s] renders as a table", (kind) => {
    const quoted = D6.split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const html = render(`> [!${kind}] Random table\n>\n${quoted}`);
    expect(html).toContain(`data-callout="${kind}"`);
    expect(html).toContain("<table>");
    expect(html).toContain("An empty barrel");
  });

  test("a table inside an `## If:` branch renders as a table", () => {
    const html = render(`## If: they roll on the table\n\n${D6}\n`);
    expect(html).toContain("data-if-section");
    expect(html).toContain("<table>");
  });

  test("`[[slug]]` in a cell degrades exactly like one in prose", () => {
    // The Grimoire pass walks the tree the table pass produced, so a cell is
    // not a blind spot: an unresolved reference shows its literal source here
    // just as it does in a paragraph (see remark-grimoire.test.ts for the
    // mdast side, where the cell's reference is marked for resolution).
    const cell = render("| Who |\n| --- |\n| [[jorna]] |");
    expect(cell).toContain("[[jorna]]");
    expect(cell).toContain("<td>");
  });
});

describe("the rest of GFM stays text", () => {
  test("a task list stays a plain list — no checkbox (inbox syntax)", () => {
    const html = render("- [x] done\n- [ ] open\n");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("checkbox");
    expect(html).toContain("[x] done");
    expect(html).toContain("[ ] open");
  });

  test("strikethrough stays text", () => {
    const html = render("The ~~old~~ new tower.\n");
    expect(html).not.toContain("<del");
    expect(html).toContain("~~old~~");
  });

  test("a bare URL is not autolinked and a footnote marker stays text", () => {
    const html = render("See www.example.com and the footnote[^1].\n");
    expect(html).not.toContain("<a ");
    expect(html).toContain("www.example.com");
    expect(html).toContain("[^1]");
  });
});
