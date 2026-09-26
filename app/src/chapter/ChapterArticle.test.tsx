// Render tests for the article of a chapter's reading view (react-dom/server —
// no DOM): the titled header, and never the scene's type overline above it.

import type { Chapter } from "@grimoire/shared/chapter";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { ChapterArticle } from "./ChapterArticle";

const t = translator("de");

function chapter(over: Partial<Chapter> = {}): Chapter {
  return { id: "01-salt-harbour", title: "Salt Harbour", body: "", rev: 1, ...over };
}

function render(value: Chapter): string {
  return renderToStaticMarkup(<ChapterArticle chapter={value} />);
}

describe("the article of a chapter", () => {
  test("renders title plus text", () => {
    const html = render(chapter({ body: "## Goal\n\nLight on.\n" }));
    expect(html).toContain("Salt Harbour");
    expect(html).toContain("Light on.");
    expect(html).not.toContain(t("sceneArticle.type.planned"));
  });

  test("the action slot stays ONE spaced group", () => {
    // The slot carries more than one trigger; the header puts it in a
    // `justify-between` row, so without the group wrapper the first button
    // would be stranded in the middle of the header.
    const actions = (
      <>
        {/* Stand-in caller markup, not app copy — the literals stay, in an
            expression container so the i18n lint rule is satisfied. */}
        <button type="button">{"first"}</button>
        <button type="button">{"second"}</button>
      </>
    );
    const grouped =
      /<span class="[^"]*gap-2[^"]*"><button[^>]*>first<\/button><button[^>]*>second<\/button><\/span>/;
    expect(renderToStaticMarkup(<ChapterArticle chapter={chapter()} actions={actions} />)).toMatch(
      grouped,
    );
    // No actions, no wrapper markup.
    expect(render(chapter())).not.toMatch(/<span class="[^"]*gap-2[^"]*"><\/span>/);
  });

  test("a chapter without a title is shown under its id", () => {
    expect(render(chapter({ title: "" }))).toContain("01-salt-harbour");
  });
});
