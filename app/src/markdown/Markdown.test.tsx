// Render tests for the markdown pipeline (react-dom/server — no DOM
// needed): callout anatomy, read-aloud without label row, open-by-default
// if-sections, and the degrade paths.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "./Markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
}

describe("Markdown pipeline rendering", () => {
  test("check callout renders label row and tagged section", () => {
    const html = render("> [!check] Wisdom (Perception) DC 13.");
    expect(html).toContain('data-callout="check"');
    expect(html).toContain(">Check<");
    expect(html).toContain("Wisdom (Perception) DC 13.");
  });

  test("callout labels match the design reference", () => {
    expect(render("> [!secret] x")).toContain(">Geheim<");
    expect(render("> [!outcome] x")).toContain(">Konsequenz<");
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
