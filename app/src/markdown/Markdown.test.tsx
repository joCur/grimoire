// Render tests for the markdown pipeline (react-dom/server — no DOM
// needed): callout anatomy, read-aloud without label row, open-by-default
// if-sections, and the degrade paths.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "./Markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
}

/** The reference fixtures CLAUDE.md names for renderer changes, body only. */
function fixtureBody(rel: string): string {
  const raw = readFileSync(new URL(`../../../examples/beispiel/${rel}`, import.meta.url), "utf8");
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  return match === null ? raw : raw.slice(match[0].length);
}

const FIXTURES = [
  "01-salzhafen/hafen/ankunft-leuchtturm.md",
  "01-salzhafen/hafen/von-schmugglern-erwischt.md",
  "npcs/fenn.md",
];

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

// Raw HTML is dropped instead of printed (skipHtml, review of issue #26): the
// generator leaves `<!-- … -->` hints in the files, and they were showing up
// as visible text under `## Notizen`.
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

  test("the npc fixture that carries the comment renders without it", () => {
    const html = render(fixtureBody("npcs/fenn.md"));
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("wird von der App");
    expect(html).toContain("<h2>Notizen</h2>");
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
    const smugglers = render(fixtureBody("01-salzhafen/hafen/von-schmugglern-erwischt.md"));
    expect([...smugglers.matchAll(/data-callout="/g)]).toHaveLength(3);
    expect([...smugglers.matchAll(/data-if-section="/g)]).toHaveLength(2);
    expect(smugglers).toContain("Falls:");

    const lighthouse = render(fixtureBody("01-salzhafen/hafen/ankunft-leuchtturm.md"));
    expect(lighthouse).toContain('data-callout="readaloud"');
    expect(lighthouse).toContain('data-callout="check"');
  });
});
