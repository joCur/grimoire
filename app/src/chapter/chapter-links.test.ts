import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import { chapterHref, chapterLabel, chapterPageCrumbs } from "./chapter-links";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [{ id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm von Salzhafen", scenes: [] }],
  npcs: [],
  locations: [],
  sessions: [],
};

describe("where a chapter lives", () => {
  test("its reading view is its own route, by id", () => {
    expect(chapterHref("beispiel", "01-salzhafen")).toBe("/campaigns/beispiel/chapters/01-salzhafen");
    expect(chapterHref("beispiel", "a b")).toBe("/campaigns/beispiel/chapters/a%20b");
  });

  test("it names itself by its resource segment and id", () => {
    expect(chapterLabel("01-salzhafen")).toBe("chapters/01-salzhafen");
  });
});

describe("chapterPageCrumbs", () => {
  test("the chapter reads its title, linking to the chapter overview", () => {
    expect(chapterPageCrumbs("beispiel", "01-salzhafen", tree)).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/campaigns/beispiel" },
    ]);
  });

  test("degrades: an unknown chapter keeps its id, and so does a missing tree", () => {
    expect(chapterPageCrumbs("beispiel", "09-unbekannt", tree)).toEqual([
      { label: "09-unbekannt", to: "/campaigns/beispiel" },
    ]);
    expect(chapterPageCrumbs("beispiel", "01-salzhafen", undefined)).toEqual([
      { label: "01-salzhafen", to: "/campaigns/beispiel" },
    ]);
  });

  test("no campaign or no id yields nothing", () => {
    expect(chapterPageCrumbs("", "01-salzhafen", tree)).toEqual([]);
    expect(chapterPageCrumbs("beispiel", "", tree)).toEqual([]);
  });
});
