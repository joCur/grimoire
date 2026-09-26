import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import { chapterHref, chapterLabel, chapterPageCrumbs } from "./chapter-links";

const tree: CampaignTree = {
  campaign: "example",
  chapters: [{ id: "01-salt-harbour", title: "Chapter 1: The Lighthouse of Salt Harbour", scenes: [] }],
  npcs: [],
  locations: [],
  sessions: [],
};

describe("where a chapter lives", () => {
  test("its reading view is its own route, by id", () => {
    expect(chapterHref("example", "01-salt-harbour")).toBe("/campaigns/example/chapters/01-salt-harbour");
    expect(chapterHref("example", "a b")).toBe("/campaigns/example/chapters/a%20b");
  });

  test("it names itself by its resource segment and id", () => {
    expect(chapterLabel("01-salt-harbour")).toBe("chapters/01-salt-harbour");
  });
});

describe("chapterPageCrumbs", () => {
  test("the chapter reads its title, linking to the chapter overview", () => {
    expect(chapterPageCrumbs("example", "01-salt-harbour", tree)).toEqual([
      { label: "Chapter 1: The Lighthouse of Salt Harbour", to: "/campaigns/example" },
    ]);
  });

  test("degrades: an unknown chapter keeps its id, and so does a missing tree", () => {
    expect(chapterPageCrumbs("example", "09-unknown", tree)).toEqual([
      { label: "09-unknown", to: "/campaigns/example" },
    ]);
    expect(chapterPageCrumbs("example", "01-salt-harbour", undefined)).toEqual([
      { label: "01-salt-harbour", to: "/campaigns/example" },
    ]);
  });

  test("no campaign or no id yields nothing", () => {
    expect(chapterPageCrumbs("", "01-salt-harbour", tree)).toEqual([]);
    expect(chapterPageCrumbs("example", "", tree)).toEqual([]);
  });
});
