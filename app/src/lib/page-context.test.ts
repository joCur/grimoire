import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/types";

import { pageContextCrumbs } from "./page-context";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [{ id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm von Salzhafen", scenes: [] }],
  npcs: [],
  locations: [],
  sessions: [],
};

describe("pageContextCrumbs", () => {
  test("a chapter reads its title, linking to the chapter overview", () => {
    expect(pageContextCrumbs("beispiel", "01-salzhafen", tree)).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/campaigns/beispiel" },
    ]);
  });

  test("the campaign and addresses outside the hierarchy get no context line", () => {
    for (const path of ["campaign", "npcs", "sessions", "inbox", "glossary", "01-salzhafen/prolog"]) {
      expect(pageContextCrumbs("beispiel", path, tree)).toEqual([]);
    }
  });

  test("degrades: an unknown chapter keeps its id, and so does a missing tree", () => {
    expect(pageContextCrumbs("beispiel", "09-unbekannt", tree)).toEqual([
      { label: "09-unbekannt", to: "/campaigns/beispiel" },
    ]);
    expect(pageContextCrumbs("beispiel", "01-salzhafen", undefined)).toEqual([
      { label: "01-salzhafen", to: "/campaigns/beispiel" },
    ]);
  });

  test("no campaign or no path yields nothing", () => {
    expect(pageContextCrumbs("", "01-salzhafen", tree)).toEqual([]);
    expect(pageContextCrumbs("beispiel", "", tree)).toEqual([]);
  });
});
