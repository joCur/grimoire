// Render tests for the entry reading view (react-dom/server — no DOM):
// the titled header and the one rule behind it — the scene type overline
// never appears above a non-scene. (An npc and a location have their own
// articles: ./NpcArticle.test.tsx, ./LocationArticle.test.tsx.)

import type { EntryKind, EntryResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityArticle } from "./EntityArticle";

function entry(
  kind: EntryKind,
  properties: Record<string, unknown>,
  body = "",
): EntryResponse {
  return { path: "01-salzhafen", kind, properties, body, rev: 1 };
}

function render(e: EntryResponse): string {
  return renderToStaticMarkup(<EntityArticle entry={e} />);
}

describe("EntityArticle — titled entities", () => {
  test("chapter renders title plus body", () => {
    const html = render(
      entry("chapter", { id: "01-salzhafen", title: "Salzhafen" }, "## Ziel\n\nLicht an.\n"),
    );
    expect(html).toContain("Salzhafen");
    expect(html).toContain("Licht an.");
    expect(html).not.toContain("Geplante Szene");
  });

  test("the action slot stays ONE spaced group", () => {
    // The slot carries more than one trigger; the
    // headers put it in a `justify-between` row, so without the group wrapper
    // the first button would be stranded in the middle of the header.
    const actions = (
      <>
        {/* Stand-in caller markup, not app copy — the literals stay, in an
            expression container so the i18n lint rule is satisfied. */}
        <button type="button">{"Bearbeiten"}</button>
        <button type="button">{"Eigenschaften"}</button>
      </>
    );
    const grouped =
      /<span class="[^"]*gap-2[^"]*"><button[^>]*>Bearbeiten<\/button><button[^>]*>Eigenschaften<\/button><\/span>/;
    const chapter = entry("chapter", { id: "01-salzhafen", title: "Salzhafen" });
    expect(renderToStaticMarkup(<EntityArticle entry={chapter} actions={actions} />)).toMatch(
      grouped,
    );
    // No actions, no wrapper markup.
    expect(render(chapter)).not.toMatch(/<span class="[^"]*gap-2[^"]*"><\/span>/);
  });

  test("a titled entry without a title falls back to its address", () => {
    expect(render(entry("chapter", {}, ""))).toContain("01-salzhafen");
  });

  test("the campaign renders the quiet titled header", () => {
    const campaign = render(entry("campaign", { id: "beispiel", name: "Beispiel" }, "Freitext.\n"));
    expect(campaign).toContain("Beispiel");
    expect(campaign).toContain("Freitext.");
    expect(campaign).not.toContain("Geplante Szene");
  });
});
