// Render tests for the fields of a chapter (react-dom/server — no DOM): the
// title is needed, the status is a select over its closed list, and clearing
// it is a choice of its own.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { ChapterFields } from "./ChapterFields";
import type { ChapterFormValues } from "./chapter-form";

const t = translator("de");

function render(values: ChapterFormValues): string {
  return renderToStaticMarkup(<ChapterFields values={values} onChange={() => {}} />);
}

/** How often a substring occurs. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the chapter's fields", () => {
  test("the title is a text field, marked as needed", () => {
    const html = render({ title: "Salt Harbour", status: "" });
    expect(html).toContain('value="Salt Harbour"');
    expect(html).toContain(t("properties.field.required"));
  });

  test("the status select offers the closed list, plus clearing it", () => {
    // The column is a CHECK constraint (decisions/constraints), so the three values are the
    // whole list — plus the empty option, which clears the status on save.
    const html = render({ title: "Salt Harbour", status: "active" });
    expect(html).toContain('value="active" selected');
    expect(html).toContain(t("properties.chapter.status.planned"));
    expect(html).toContain(t("properties.chapter.status.done"));
    expect(html).toContain(t("properties.field.unset"));
    expect(count(html, "<option")).toBe(4);
  });
});
