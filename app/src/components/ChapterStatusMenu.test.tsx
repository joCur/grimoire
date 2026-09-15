// Render test for the chapter-status regler (issue #115): the open menu lists
// the three German labels, marks the current one, and the trigger names it for
// a screen reader in the wording the PO asked for.
//
// Radix renders menu content into a PORTAL, and react-dom/server renders no
// portals — so the portal is the one part replaced by a pass-through here.
// Everything else (trigger, radio group, items, labels) is the real component.

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

void mock.module("@radix-ui/react-dropdown-menu", () => ({
  ...DropdownPrimitive,
  Portal: ({ children }: { children?: ReactNode }) => children,
}));

const { ChapterStatusMenu } = await import("./ChapterStatusMenu");

function render(props: Partial<Parameters<typeof ChapterStatusMenu>[0]> = {}): string {
  return renderToStaticMarkup(
    <ChapterStatusMenu status="planned" open onSelect={() => {}} {...props} />,
  );
}

/** The item labels in menu order, read out of the rendered markup. */
function itemLabels(html: string): string[] {
  return [...html.matchAll(/role="menuitemradio"[^>]*>.*?<span class="flex-1">([^<]*)</g)].map(
    (m) => m[1] ?? "",
  );
}

describe("ChapterStatusMenu", () => {
  test("lists the three German labels as single-choice options", () => {
    expect(itemLabels(render())).toEqual(["Geplant", "Aktiv", "Abgeschlossen"]);
  });

  test("the current value is the checked option", () => {
    const html = render({ status: "active" });
    expect([...html.matchAll(/aria-checked="true"/g)]).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?<span class="flex-1">Aktiv</);
  });

  test("an unknown value shows verbatim and checks nothing", () => {
    // The format degrades: a pre-#115 row keeps its text, and the menu still
    // offers only the trio the API accepts.
    const html = render({ status: "laeuft" });
    expect(html).toContain("laeuft");
    expect(itemLabels(html)).toEqual(["Geplant", "Aktiv", "Abgeschlossen"]);
    expect(html).not.toContain('aria-checked="true"');
  });

  test("the trigger names the current status for screen readers", () => {
    expect(render({ status: "done" })).toContain(
      'aria-label="Status ändern, aktuell Abgeschlossen"',
    );
  });

  test("while a write runs the trigger shows the target value dimmed", () => {
    const html = render({ status: "planned", pendingStatus: "active" });
    expect(html).toContain("opacity-60");
    // The pill shows the target, the menu still checks the stored value.
    expect(html).toMatch(/opacity-60">Aktiv</);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?<span class="flex-1">Geplant</);
  });

  test("the conflict line is a quiet inline message, not a toast", () => {
    const html = render({ message: "Inzwischen geändert — neu laden" });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Inzwischen geändert — neu laden");
  });
});
