// Render tests for the properties controls of a chapter (react-dom/server —
// no DOM): the status is a select over its closed list, and clearing it is a
// choice of its own.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";
import { propertiesFieldsFor, type PropertiesField } from "@/lib/properties-form";

import { PropertiesFieldControl } from "./PropertiesFields";

// The helpers take the translator as an argument, so a test names the
// language it asserts.
const t = translator("de");

function chapterField(key: string): PropertiesField {
  const field = (propertiesFieldsFor("chapter", t) ?? []).find((f) => f.key === key);
  if (field === undefined) throw new Error(`no chapter field ${key}`);
  return field;
}

function render(field: PropertiesField, value: string): string {
  return renderToStaticMarkup(
    <PropertiesFieldControl field={field} value={value} onChange={() => {}} />,
  );
}

/** How often a substring occurs. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the chapter's fields", () => {
  test("the title is a text field, marked as needed", () => {
    const html = render(chapterField("title"), "Salzhafen");
    expect(html).toContain('value="Salzhafen"');
    expect(html).toContain("nötig");
  });

  test("the status select offers the closed list, plus clearing it", () => {
    // The column is a CHECK constraint (ADR #25), so the three values are the
    // whole list — plus the empty option, which deletes the key on save.
    const html = render(chapterField("status"), "active");
    expect(html).toContain('value="active" selected');
    expect(html).toContain("Geplant");
    expect(html).toContain("— nicht gesetzt —");
    expect(count(html, "<option")).toBe(4);
  });
});
