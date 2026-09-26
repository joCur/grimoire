// The chapter's action in the overview is the shared header trigger with the
// edit glyph, under the chapter-named label: the campaign's own edit action
// stands on the same page.

import { describe, expect, test } from "bun:test";
import { PenLine } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { HeaderAction } from "@/components/HeaderAction";
import { translator } from "@/i18n/format";

import { ChapterOverviewActions } from "./ChapterActions";

const t = translator("de");

describe("ChapterOverviewActions", () => {
  test("is the shared trigger under the chapter-named edit label", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ChapterOverviewActions campaign="example" id="01-salt-harbour" />
      </MemoryRouter>,
    );
    expect(html).toContain(
      renderToStaticMarkup(
        <HeaderAction icon={PenLine} label={t("chapterOverview.chapter.edit")} onClick={() => {}} />,
      ),
    );
  });
});
