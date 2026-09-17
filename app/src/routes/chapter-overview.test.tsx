// The chapter overview's grouping heading.
//
// A scene's group IS its `location`, so the heading is the LOCATION'S NAME —
// and the group `""` is not a location with an empty name but the scenes
// that name none. They get a neutral section from the catalog („Ohne Ort"),
// never a blank line where a heading belongs.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { CampaignTree, SceneGroup, SceneSummary } from "@grimoire/shared";

import { PlannedGroup } from "./chapter-overview";

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

const tree = {
  campaign: "beispiel",
  chapters: [],
  npcs: [],
  locations: [
    { path: "locations/leuchtturm", id: "leuchtturm", name: "Der Leuchtturm von Salzhafen" },
    { path: "locations/bucht", id: "bucht", name: "bucht" },
  ],
  sessions: [],
} as unknown as CampaignTree;

function render(group: SceneGroup): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlannedGroup campaign="beispiel" group={group} tree={tree} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PlannedGroup — the heading is the location", () => {
  test("a named location heads its group with its NAME, not its slug", () => {
    const html = render({
      slug: "leuchtturm",
      name: "Der Leuchtturm von Salzhafen",
      scenes: [scene("ankunft")],
    });
    expect(html).toContain("Der Leuchtturm von Salzhafen");
    expect(html).not.toContain(">leuchtturm<");
  });

  test("a location nobody has named yet shows its id", () => {
    // The entry exists and has no name of its own.
    // The heading must be the word the DM typed, never a blank line: the
    // tree degrades an empty name to the id and so does this view, so the
    // fixture carries the EMPTY name the database actually holds.
    const html = render({ slug: "bucht", name: "", scenes: [scene("erwischt")] });
    expect(html).toContain(">bucht<");
  });

  test("the scenes without a location get the neutral section", () => {
    const html = render({ slug: "", name: "", scenes: [scene("heimatlos")] });
    expect(html).toContain("Ohne Ort");
  });

  test("a group with nothing but contingencies renders nothing at all", () => {
    const html = render({
      slug: "",
      name: "",
      scenes: [scene("notfall", { type: "contingency" })],
    });
    expect(html).toBe("");
  });
});
