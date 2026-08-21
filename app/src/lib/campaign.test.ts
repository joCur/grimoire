import { describe, expect, test } from "bun:test";
import type { CampaignSummary, CampaignTree, SceneSummary } from "@grimoire/shared/types";

import { locationName, pickLastCampaign, sceneTitle } from "./campaign";

const c = (id: string, lastSession?: string): CampaignSummary =>
  lastSession === undefined ? { id } : { id, lastSession };

describe("pickLastCampaign", () => {
  test("no campaign at all → undefined (empty state)", () => {
    expect(pickLastCampaign([])).toBeUndefined();
  });

  test("exactly one campaign always wins — with or without sessions", () => {
    expect(pickLastCampaign([c("beispiel", "2026-01-15")])).toBe("beispiel");
    expect(pickLastCampaign([c("beispiel")])).toBe("beispiel");
  });

  test("newest session wins over the alphabetically first id", () => {
    expect(pickLastCampaign([c("alpha", "2026-01-15"), c("zeta", "2026-06-01")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", "2026-06-01"), c("alpha", "2026-01-15")])).toBe("zeta");
  });

  test("campaigns without a session rank behind every campaign with one", () => {
    expect(pickLastCampaign([c("alpha"), c("zeta", "2020-01-01")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", "2020-01-01"), c("alpha")])).toBe("zeta");
  });

  test("tie on the session id → alphabetically first", () => {
    expect(pickLastCampaign([c("zeta", "2026-03-09"), c("alpha", "2026-03-09")])).toBe("alpha");
  });

  test("nobody has a session → alphabetically first", () => {
    expect(pickLastCampaign([c("zeta"), c("beta"), c("alpha")])).toBe("alpha");
  });

  test("degrades on unexpected values: empty lastSession counts as none", () => {
    expect(pickLastCampaign([c("alpha", ""), c("zeta", "2026-01-15")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", ""), c("alpha", "")])).toBe("alpha");
  });
});

const scene = (id: string, title: string): SceneSummary => ({
  path: `01-salzhafen/hafen/${id}.md`,
  id,
  title,
  type: "planned",
  status: "ready",
  npcs: [],
  tags: [],
});

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [
    { id: "01-salzhafen", title: "Kapitel 1", groups: [] },
    {
      id: "02-bucht",
      title: "Kapitel 2",
      groups: [
        { slug: "", scenes: [scene("lighthouse-arrival", "Ankunft am Leuchtturm")] },
        { slug: "hafen", scenes: [scene("smuggler-captured", "Von den Schmugglern erwischt")] },
      ],
    },
  ],
  npcs: [],
  locations: [
    { path: "locations/leuchtturm.md", id: "leuchtturm", name: "Der Leuchtturm von Salzhafen" },
  ],
  sessions: [],
};

describe("locationName", () => {
  test("resolves a known id to its name — this is what a pool group header shows", () => {
    expect(locationName(tree, "leuchtturm")).toBe("Der Leuchtturm von Salzhafen");
  });

  test("an unknown slug passes through unchanged (group dirs need no location)", () => {
    expect(locationName(tree, "hafen")).toBe("hafen");
    expect(locationName(undefined, "hafen")).toBe("hafen");
    expect(locationName(tree, undefined)).toBeUndefined();
  });
});

describe("sceneTitle", () => {
  test("finds the title across chapters and groups", () => {
    expect(sceneTitle(tree, "lighthouse-arrival")).toBe("Ankunft am Leuchtturm");
    expect(sceneTitle(tree, "smuggler-captured")).toBe("Von den Schmugglern erwischt");
  });

  test("degrades to the id when the tree does not know the scene", () => {
    expect(sceneTitle(tree, "weg-vom-fenster")).toBe("weg-vom-fenster");
    expect(sceneTitle(undefined, "lighthouse-arrival")).toBe("lighthouse-arrival");
  });

  test("no scene id at all → nothing to label", () => {
    expect(sceneTitle(tree, undefined)).toBeUndefined();
  });
});
