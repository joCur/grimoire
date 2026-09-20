// Render test for one row of the chapter overview (ADR #27): the location is
// a word in the meta line now, not a heading above the row, and every row
// carries the two controls that set the order.
//
// A scene without a location must show no placeholder and no dangling
// separator — "Ohne Ort" was a heading of the old grouping and is gone with
// it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { SceneSummary } from "@grimoire/shared";

import { SceneRow } from "./chapter-overview";

function scene(id: string, over: Partial<SceneSummary> = {}): SceneSummary {
  return {
    path: `01-salzhafen/${id}`,
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
          campaign="beispiel"
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
      scene("ankunft", {
        location: "leuchtturm",
        locationName: "Der Leuchtturm von Salzhafen",
        tags: ["social"],
      }),
    );
    expect(html).toContain("Der Leuchtturm von Salzhafen · #social");
  });

  test("a location nobody has named yet shows its id", () => {
    // The tree degrades an empty name to the id server-side; a row must never
    // print a blank where the location goes.
    const html = render(scene("erwischt", { location: "bucht", locationName: "bucht" }));
    expect(html).toContain("bucht");
  });

  test("no location means no location part — the tags stand alone", () => {
    const html = render(scene("heimatlos", { tags: ["combat"] }));
    expect(html).toContain("#combat");
    expect(html).not.toContain("·");
    expect(html).not.toContain("Ohne Ort");
  });
});

describe("the row sets the order", () => {
  test("both controls name their scene", () => {
    const html = render(scene("ankunft", { title: "Ankunft am Leuchtturm" }));
    expect(html).toContain('aria-label="„Ankunft am Leuchtturm“ nach oben"');
    expect(html).toContain('aria-label="„Ankunft am Leuchtturm“ nach unten"');
  });

  test("the first row of a block cannot move up, the last cannot move down", () => {
    const first = render(scene("a"), { first: true });
    expect(first).toContain('nach oben" disabled=""');
    expect(first).not.toContain('nach unten" disabled=""');

    const last = render(scene("a"), { last: true });
    expect(last).toContain('nach unten" disabled=""');
    expect(last).not.toContain('nach oben" disabled=""');
  });

  test("while a move is on the wire the rows hold still", () => {
    const html = render(scene("a"), { busy: true });
    expect(html).toContain('nach oben" disabled=""');
    expect(html).toContain('nach unten" disabled=""');
  });
});
