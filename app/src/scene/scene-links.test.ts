import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import { sceneHref, sceneLabel, scenePageCrumbs } from "./scene-links";

const tree: CampaignTree = {
  campaign: "example",
  chapters: [{ id: "01-salt-harbour", title: "Chapter 1: The Lighthouse of Salt Harbour", scenes: [] }],
  npcs: [],
  locations: [{ id: "lighthouse", name: "The Lighthouse of Salt Harbour" }],
  sessions: [],
};

describe("where a scene lives", () => {
  test("its reading view is its own route, by id", () => {
    expect(sceneHref("example", "lighthouse-arrival")).toBe(
      "/campaigns/example/scenes/lighthouse-arrival",
    );
    expect(sceneHref("example", "a b")).toBe("/campaigns/example/scenes/a%20b");
  });

  test("it names itself by its resource segment and id", () => {
    expect(sceneLabel("lighthouse-arrival")).toBe("scenes/lighthouse-arrival");
  });
});

describe("scenePageCrumbs", () => {
  test("chapter title, then the location's name; the chapter links to the overview", () => {
    expect(
      scenePageCrumbs("example", { chapter: "01-salt-harbour", location: "lighthouse" }, tree),
    ).toEqual([
      { label: "Chapter 1: The Lighthouse of Salt Harbour", to: "/campaigns/example" },
      { label: "The Lighthouse of Salt Harbour" },
    ]);
  });

  test("a scene without a location has no location step", () => {
    expect(scenePageCrumbs("example", { chapter: "01-salt-harbour" }, tree)).toEqual([
      { label: "Chapter 1: The Lighthouse of Salt Harbour", to: "/campaigns/example" },
    ]);
  });

  test("the campaign name never appears in the context line", () => {
    const labels = scenePageCrumbs("example", { chapter: "01-salt-harbour" }, tree).map(
      (crumb) => crumb.label,
    );
    expect(labels).not.toContain("example");
  });

  test("degrades: an unknown chapter or location keeps its id, and so does a missing tree", () => {
    expect(scenePageCrumbs("example", { chapter: "09-unknown", location: "harbour" }, tree)).toEqual(
      [{ label: "09-unknown", to: "/campaigns/example" }, { label: "harbour" }],
    );
    expect(
      scenePageCrumbs("example", { chapter: "01-salt-harbour", location: "lighthouse" }, undefined),
    ).toEqual([{ label: "01-salt-harbour", to: "/campaigns/example" }, { label: "lighthouse" }]);
  });

  test("no campaign yields nothing", () => {
    expect(scenePageCrumbs("", { chapter: "01-salt-harbour" }, tree)).toEqual([]);
  });
});
