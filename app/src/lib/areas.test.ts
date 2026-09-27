import { describe, expect, test } from "bun:test";

import { AREAS, AREA_GROUPS, areasOf, currentArea } from "./areas";

describe("currentArea", () => {
  test("the chapter overview and a chapter's reading view are the chapters", () => {
    expect(currentArea("/campaigns/example")?.id).toBe("chapters");
    expect(currentArea("/campaigns/example/chapters/one")?.id).toBe("chapters");
  });

  test("a list and the reading views opened from it are the same area", () => {
    expect(currentArea("/campaigns/example/scenes")?.id).toBe("scenes");
    expect(currentArea("/campaigns/example/scenes/lighthouse-arrival")?.id).toBe("scenes");
    expect(currentArea("/campaigns/example/npcs")?.id).toBe("npcs");
    expect(currentArea("/campaigns/example/npcs/fenn")?.id).toBe("npcs");
    expect(currentArea("/campaigns/example/locations")?.id).toBe("locations");
    expect(currentArea("/campaigns/example/locations/cove")?.id).toBe("locations");
  });

  test("the reference pages, the session review and the trash are areas of their own", () => {
    expect(currentArea("/campaigns/example/glossary")?.id).toBe("glossary");
    expect(currentArea("/campaigns/example/knowledge")?.id).toBe("knowledge");
    expect(currentArea("/campaigns/example/review")?.id).toBe("review");
    expect(currentArea("/campaigns/example/trash")?.id).toBe("trash");
  });

  test("views that belong to no area mark nothing", () => {
    expect(currentArea("/campaigns/example/live")).toBeUndefined();
    expect(currentArea("/campaigns/example/generate")).toBeUndefined();
    expect(currentArea("/campaigns/example/sessions/2026-01-15")).toBeUndefined();
    expect(currentArea("/settings")).toBeUndefined();
    expect(currentArea("/")).toBeUndefined();
  });
});

describe("AREAS", () => {
  test("every area sits in exactly one group, and every group has areas", () => {
    const grouped = AREA_GROUPS.flatMap((group) => areasOf(group.id));
    expect(grouped.map((area) => area.id)).toEqual(AREAS.map((area) => area.id));
    for (const group of AREA_GROUPS) expect(areasOf(group.id).length).toBeGreaterThan(0);
  });

  test("each area leads to one of its own routes", () => {
    for (const area of AREAS) expect(currentArea(area.href("example"))?.id).toBe(area.id);
  });
});
