// Render test for one row of the chapter overview (decisions/scene-order): the location is
// a word in the meta line, not a heading above the row, and every row carries
// the two controls that set the order.
//
// A scene without a location shows no placeholder and no dangling separator.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { SceneSummary } from "@grimoire/shared";

import { translator } from "@/i18n/format";

import { SceneRow } from "./SceneRow";

const t = translator("de");

/** The accessible names of a row's two order controls. */
const up = (title: string): string => t("chapterOverview.scene.moveUp.aria", { title });
const down = (title: string): string => t("chapterOverview.scene.moveDown.aria", { title });

function scene(id: string, over: Partial<SceneSummary> = {}): SceneSummary {
  return {
    id,
    title: id,
    type: "planned",
    status: "draft",
    npcs: [],
    tags: [],
    ...over,
  };
}

function render(
  value: SceneSummary,
  over: { first?: boolean; last?: boolean; busy?: boolean } = {},
): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SceneRow
          campaign="example"
          scene={value}
          first={over.first ?? false}
          last={over.last ?? false}
          busy={over.busy ?? false}
          onMove={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the meta line carries the location", () => {
  test("the resolved NAME, not the id behind it", () => {
    const html = render(
      scene("arrival", {
        location: "lighthouse",
        locationName: "The Lighthouse of Salt Harbour",
        tags: ["social"],
      }),
    );
    expect(html).toContain("The Lighthouse of Salt Harbour · #social");
  });

  test("a location nobody has named yet shows its id", () => {
    // The tree degrades an empty name to the id server-side; a row must never
    // print a blank where the location goes.
    const html = render(scene("captured", { location: "cove", locationName: "cove" }));
    expect(html).toContain("cove");
  });

  test("no location means no location part — the tags stand alone", () => {
    const html = render(scene("homeless", { tags: ["combat"] }));
    expect(html).toContain("#combat");
    expect(html).not.toContain("·");
    // The meta line is the tags and nothing before them.
    expect(html).toContain('text-muted-foreground">#combat</span>');
  });
});

/** Whether the button with this accessible name carries the disabled flag. */
function isDisabled(html: string, label: string): boolean {
  const button = [...html.matchAll(/<button[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`aria-label="${label}"`));
  if (button === undefined) throw new Error(`no button named ${label}`);
  return button.includes('disabled=""');
}

describe("the row sets the order", () => {
  test("both controls name their scene", () => {
    const html = render(scene("arrival", { title: "Arrival at the Lighthouse" }));
    expect(html).toContain(`aria-label="${up("Arrival at the Lighthouse")}"`);
    expect(html).toContain(`aria-label="${down("Arrival at the Lighthouse")}"`);
  });

  test("the first row of a block cannot move up, the last cannot move down", () => {
    const first = render(scene("a"), { first: true });
    expect(isDisabled(first, up("a"))).toBe(true);
    expect(isDisabled(first, down("a"))).toBe(false);

    const last = render(scene("a"), { last: true });
    expect(isDisabled(last, down("a"))).toBe(true);
    expect(isDisabled(last, up("a"))).toBe(false);
  });

  test("while a move is on the wire the rows hold still", () => {
    const html = render(scene("a"), { busy: true });
    expect(isDisabled(html, up("a"))).toBe(true);
    expect(isDisabled(html, down("a"))).toBe(true);
  });
});
