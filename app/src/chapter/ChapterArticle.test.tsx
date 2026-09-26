// Render tests for the article of a chapter's reading view (react-dom/server —
// no DOM): the titled header, and never the scene's type overline above it.

import type { Chapter } from "@grimoire/shared/chapter";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChapterArticle } from "./ChapterArticle";

function chapter(over: Partial<Chapter> = {}): Chapter {
  return { id: "01-salzhafen", title: "Salzhafen", body: "", rev: 1, ...over };
}

function render(value: Chapter): string {
  return renderToStaticMarkup(<ChapterArticle chapter={value} />);
}

describe("the article of a chapter", () => {
  test("renders title plus text", () => {
    const html = render(chapter({ body: "## Ziel\n\nLicht an.\n" }));
    expect(html).toContain("Salzhafen");
    expect(html).toContain("Licht an.");
    expect(html).not.toContain("Geplante Szene");
  });

  test("the action slot stays ONE spaced group", () => {
    // The slot carries more than one trigger; the header puts it in a
    // `justify-between` row, so without the group wrapper the first button
    // would be stranded in the middle of the header.
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
    expect(renderToStaticMarkup(<ChapterArticle chapter={chapter()} actions={actions} />)).toMatch(
      grouped,
    );
    // No actions, no wrapper markup.
    expect(render(chapter())).not.toMatch(/<span class="[^"]*gap-2[^"]*"><\/span>/);
  });

  test("a chapter without a title is shown under its id", () => {
    expect(render(chapter({ title: "" }))).toContain("01-salzhafen");
  });
});
