// The chapter's dialog action is the shared header trigger with the fields
// glyph — under its plain name on the reading view, under the chapter-named
// label in the overview, where the campaign's own edit action stands on the
// same page.

import type { Chapter } from "@grimoire/shared/chapter";
import { describe, expect, test } from "bun:test";
import { SlidersHorizontal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeaderAction } from "@/components/HeaderAction";
import { translator } from "@/i18n/format";

import { ChapterFieldsAction } from "./ChapterActions";

const t = translator("de");

const CHAPTER: Chapter = { id: "01-salt-harbour", title: "Salt Harbour", body: "", rev: 1 };

function trigger(label: string): string {
  return renderToStaticMarkup(
    <HeaderAction icon={SlidersHorizontal} label={label} onClick={() => {}} />,
  );
}

describe("ChapterFieldsAction", () => {
  test("is the shared trigger under the plain fields label", () => {
    expect(
      renderToStaticMarkup(<ChapterFieldsAction campaign="example" chapter={CHAPTER} />),
    ).toBe(trigger(t("properties.action")));
  });

  test("takes the chapter-named label where the overview asks for it", () => {
    expect(
      renderToStaticMarkup(
        <ChapterFieldsAction campaign="example" chapter={CHAPTER} label={t("chapterOverview.chapter.properties")} />,
      ),
    ).toBe(trigger(t("chapterOverview.chapter.properties")));
  });
});
