// Render test for the status regler (issue #28): the open menu must list the
// four German labels and mark the current one.
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

const { SceneStatusMenu } = await import("./SceneStatusMenu");

function render(props: Partial<Parameters<typeof SceneStatusMenu>[0]> = {}): string {
  return renderToStaticMarkup(
    <SceneStatusMenu status="draft" variant="pill" open onSelect={() => {}} {...props} />,
  );
}

/** The item labels in menu order, read out of the rendered markup. */
function itemLabels(html: string): string[] {
  return [...html.matchAll(/role="menuitemradio"[^>]*>.*?<span class="flex-1">([^<]*)</g)].map(
    (m) => m[1] ?? "",
  );
}

describe("SceneStatusMenu", () => {
  test("lists the four German labels as single-choice options", () => {
    const html = render();
    expect(itemLabels(html)).toEqual(["Entwurf", "bereit", "gespielt", "verworfen"]);
  });

  test("the current value is the checked option", () => {
    const html = render({ status: "played" });
    // Exactly one option is checked, and it is the one with the current label.
    expect([...html.matchAll(/aria-checked="true"/g)]).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?<span class="flex-1">gespielt</);
  });

  test("an unknown value shows verbatim and checks nothing", () => {
    const html = render({ status: "verschollen" });
    expect(html).toContain("verschollen");
    expect(itemLabels(html)).toEqual(["Entwurf", "bereit", "gespielt", "verworfen"]);
    expect(html).not.toContain('aria-checked="true"');
  });

  test("the trigger names the current status for screen readers", () => {
    expect(render({ status: "ready" })).toContain('aria-label="Status ändern, aktuell bereit"');
  });

  test("while a write runs the trigger shows the target value dimmed", () => {
    const html = render({ status: "draft", pendingStatus: "ready" });
    expect(html).toContain("opacity-60");
    // The pill shows the target, the menu still checks the value on disk.
    expect(html).toMatch(/opacity-60">bereit</);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?<span class="flex-1">Entwurf</);
  });

  test("the conflict line is a quiet inline message, not a toast", () => {
    const html = render({ message: "Inzwischen geändert — neu laden" });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Inzwischen geändert — neu laden");
  });

  test("both densities render the same options", () => {
    expect(itemLabels(render({ variant: "row" }))).toEqual(itemLabels(render({ variant: "pill" })));
  });
});
