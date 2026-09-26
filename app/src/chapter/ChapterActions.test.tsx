// The chapter's dialog action is the shared header trigger with the fields
// glyph — under its plain name on the reading view, under the chapter-named
// label in the overview, where the campaign's own edit action stands on the
// same page.

import type { Chapter } from "@grimoire/shared/chapter";
import { describe, expect, test } from "bun:test";
import { SlidersHorizontal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeaderAction } from "@/components/HeaderAction";

import { ChapterFieldsAction } from "./ChapterActions";

const CHAPTER: Chapter = { id: "01-salzhafen", title: "Salzhafen", body: "", rev: 1 };

function trigger(label: string): string {
  return renderToStaticMarkup(
    <HeaderAction icon={SlidersHorizontal} label={label} onClick={() => {}} />,
  );
}

describe("ChapterFieldsAction", () => {
  test("is the shared trigger named „Eigenschaften“", () => {
    expect(
      renderToStaticMarkup(<ChapterFieldsAction campaign="beispiel" chapter={CHAPTER} />),
    ).toBe(trigger("Eigenschaften"));
  });

  test("takes the chapter-named label where the overview asks for it", () => {
    expect(
      renderToStaticMarkup(
        <ChapterFieldsAction campaign="beispiel" chapter={CHAPTER} label="Kapitel-Eigenschaften" />,
      ),
    ).toBe(trigger("Kapitel-Eigenschaften"));
  });
});
