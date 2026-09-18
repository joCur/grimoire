// The one conflict line: it states what happened and offers the answers as
// controls. Which answers there are depends on the write path, so that is what
// is asserted here — plus that the line announces itself, because a DM who
// pressed save and got nothing has to be told.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { EditConflict } from "./EditConflict";

/** Without a provider the catalog answers in the primary language. */
function render(props: Parameters<typeof EditConflict>[0]): string {
  return renderToStaticMarkup(<EditConflict {...props} />);
}

describe("EditConflict", () => {
  test("states it and offers both answers", () => {
    const html = render({ onReload: () => {}, onForce: () => {} });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Inzwischen geändert");
    expect(html).toContain("Neu laden");
    expect(html).toContain("Trotzdem speichern");
  });

  test("a write path without force offers reloading only", () => {
    const html = render({ onReload: () => {} });
    expect(html).toContain("Neu laden");
    expect(html).not.toContain("Trotzdem speichern");
  });

  test("both answers are off while a write runs — they would race it", () => {
    const html = render({ onReload: () => {}, onForce: () => {}, busy: true });
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  test("the English catalog carries the same three keys", () => {
    // No wording is built in the component, so both catalogs must be able to
    // answer all three — a missing one would be a typecheck failure, an empty
    // one would show as a blank line.
    for (const key of ["editConflict.line", "editConflict.reload", "editConflict.force"] as const) {
      expect(translator("en")(key)).not.toBe("");
      expect(translator("de")(key)).not.toBe("");
    }
  });
});
