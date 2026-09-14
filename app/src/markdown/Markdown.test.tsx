// Issue #96: GFM TABLES, and the four GFM extensions that stay off.
//
// Rendered HTML rather than mdast, because the question is what the DM sees:
// a table has to become a real `<table>` — in body text, in every callout and
// inside an `## If:` branch — while `- [x]`, `~~wort~~`, a bare URL and a
// `[^1]` footnote have to stay the literal text they are today. That second
// half is the load-bearing one: `- [x]` is the INBOX's check-off syntax
// (README), and a checkbox rendered from it would be a control that writes
// nothing.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CALLOUT_KINDS } from "@grimoire/shared/types";

import { Markdown } from "./Markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
}

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
    // AK 2: at 390px the TABLE scrolls. The box is the mechanism, and it is
    // focusable and named so a keyboard can reach it too.
    const html = render(W6);
    expect(html).toContain('class="md-table-scroll"');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Tabelle"');
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
