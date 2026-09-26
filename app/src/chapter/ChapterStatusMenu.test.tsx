// Render test for the chapter-status control: the open menu lists the three
// catalog labels, marks the current one, and the trigger names it for a screen
// reader.
//
// Radix renders menu content into a PORTAL, and react-dom/server renders no
// portals — so the portal is the one part replaced by a pass-through here.
// Everything else (trigger, radio group, items, labels) is the real component.

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

void mock.module("@radix-ui/react-dropdown-menu", () => ({
  ...DropdownPrimitive,
  Portal: ({ children }: { children?: ReactNode }) => children,
}));

const { ChapterStatusMenu } = await import("./ChapterStatusMenu");

const t = translator("de");
const PLANNED = t("properties.chapter.status.planned");
const ACTIVE = t("properties.chapter.status.active");
const DONE = t("properties.chapter.status.done");

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

/** The label of the one checked option. */
function checkedLabel(html: string): string | undefined {
  return /aria-checked="true"[^>]*>.*?<span class="flex-1">([^<]*)</.exec(html)?.[1];
}

describe("ChapterStatusMenu", () => {
  test("lists the three status labels as single-choice options", () => {
    expect(itemLabels(render())).toEqual([PLANNED, ACTIVE, DONE]);
  });

  test("the current value is the checked option", () => {
    const html = render({ status: "active" });
    expect([...html.matchAll(/aria-checked="true"/g)]).toHaveLength(1);
    expect(checkedLabel(html)).toBe(ACTIVE);
  });

  test("the trigger names the current status for screen readers", () => {
    expect(render({ status: "done" })).toContain(
      `aria-label="${t("status.change.aria", { current: DONE })}"`,
    );
  });

  test("while a write runs the trigger shows the target value dimmed", () => {
    const html = render({ status: "planned", pendingStatus: "active" });
    expect(html).toContain("opacity-60");
    // The pill shows the target, the menu still checks the stored value.
    expect(html).toContain(`opacity-60">${ACTIVE}<`);
    expect(checkedLabel(html)).toBe(PLANNED);
  });

  test("the conflict line is a quiet inline message, not a toast", () => {
    const html = render({ message: t("write.stale") });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(t("write.stale"));
  });
});
