import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import { sceneHref, sceneLabel, scenePageCrumbs } from "./scene-links";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [{ id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm von Salzhafen", scenes: [] }],
  npcs: [],
  locations: [{ id: "leuchtturm", name: "Der Leuchtturm von Salzhafen" }],
  sessions: [],
};

describe("where a scene lives", () => {
  test("its reading view is its own route, by id", () => {
    expect(sceneHref("beispiel", "lighthouse-arrival")).toBe(
      "/campaigns/beispiel/scenes/lighthouse-arrival",
    );
    expect(sceneHref("beispiel", "a b")).toBe("/campaigns/beispiel/scenes/a%20b");
  });

  test("it names itself by its resource segment and id", () => {
    expect(sceneLabel("lighthouse-arrival")).toBe("scenes/lighthouse-arrival");
  });
});

describe("scenePageCrumbs", () => {
  test("chapter title, then the location's name; the chapter links to the overview", () => {
    expect(
      scenePageCrumbs("beispiel", { chapter: "01-salzhafen", location: "leuchtturm" }, tree),
    ).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/campaigns/beispiel" },
      { label: "Der Leuchtturm von Salzhafen" },
    ]);
  });

  test("a scene without a location has no location step", () => {
    expect(scenePageCrumbs("beispiel", { chapter: "01-salzhafen" }, tree)).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/campaigns/beispiel" },
    ]);
  });

  test("the campaign name never appears in the context line", () => {
    const labels = scenePageCrumbs("beispiel", { chapter: "01-salzhafen" }, tree).map(
      (crumb) => crumb.label,
    );
    expect(labels).not.toContain("beispiel");
  });

  test("degrades: an unknown chapter or location keeps its id, and so does a missing tree", () => {
    expect(scenePageCrumbs("beispiel", { chapter: "09-unbekannt", location: "hafen" }, tree)).toEqual(
      [{ label: "09-unbekannt", to: "/campaigns/beispiel" }, { label: "hafen" }],
    );
    expect(
      scenePageCrumbs("beispiel", { chapter: "01-salzhafen", location: "leuchtturm" }, undefined),
    ).toEqual([{ label: "01-salzhafen", to: "/campaigns/beispiel" }, { label: "leuchtturm" }]);
  });

  test("no campaign yields nothing", () => {
    expect(scenePageCrumbs("", { chapter: "01-salzhafen" }, tree)).toEqual([]);
  });
});
