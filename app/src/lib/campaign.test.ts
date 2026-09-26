import { describe, expect, test } from "bun:test";
import type { CampaignSummary } from "@grimoire/shared/campaign";
import type { CampaignTree, SceneSummary } from "@grimoire/shared/campaign-tree";

import { hasScene, locationName, pickLastCampaign, sceneTitle, settingsCampaign } from "./campaign";

/**
 * A campaign whose newest session STARTED at `lastSessionStarted`. The
 * session's own id is opaque noise and deliberately random here — nothing in
 * the order may read it.
 */
const c = (id: string, lastSessionStarted?: string): CampaignSummary =>
  lastSessionStarted === undefined
    ? { id }
    : { id, lastSession: crypto.randomUUID(), lastSessionStarted };

describe("pickLastCampaign", () => {
  test("no campaign at all → undefined (empty state)", () => {
    expect(pickLastCampaign([])).toBeUndefined();
  });

  test("exactly one campaign always wins — with or without sessions", () => {
    expect(pickLastCampaign([c("example", "2026-01-15T19:30:00")])).toBe("example");
    expect(pickLastCampaign([c("example")])).toBe("example");
  });

  test("newest session wins over the alphabetically first id", () => {
    expect(
      pickLastCampaign([c("alpha", "2026-01-15T19:30:00"), c("zeta", "2026-06-01T18:00:00")]),
    ).toBe("zeta");
    expect(
      pickLastCampaign([c("zeta", "2026-06-01T18:00:00"), c("alpha", "2026-01-15T19:30:00")]),
    ).toBe("zeta");
  });

  test("campaigns without a session rank behind every campaign with one", () => {
    expect(pickLastCampaign([c("alpha"), c("zeta", "2020-01-01T20:00:00")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", "2020-01-01T20:00:00"), c("alpha")])).toBe("zeta");
  });

  test("tie on the session start → alphabetically first", () => {
    expect(
      pickLastCampaign([c("zeta", "2026-03-09T19:00:00"), c("alpha", "2026-03-09T19:00:00")]),
    ).toBe("alpha");
  });

  test("nobody has a session → alphabetically first", () => {
    expect(pickLastCampaign([c("zeta"), c("beta"), c("alpha")])).toBe("alpha");
  });

  test("degrades on unexpected values: empty lastSessionStarted counts as none", () => {
    expect(pickLastCampaign([c("alpha", ""), c("zeta", "2026-01-15T19:30:00")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", ""), c("alpha", "")])).toBe("alpha");
  });

  test("two sessions of the SAME DAY order by their TIME, not by their id", () => {
    // The ids say nothing about the order — the evening's second session
    // simply started later, and only the start time says so.
    expect(
      pickLastCampaign([c("alpha", "2026-09-06T18:00:00"), c("zeta", "2026-09-06T22:15:00")]),
    ).toBe("zeta");
    expect(
      pickLastCampaign([c("zeta", "2026-09-06T22:15:00"), c("alpha", "2026-09-06T18:00:00")]),
    ).toBe("zeta");
  });

  test("a later day wins over a late hour on an earlier one", () => {
    expect(
      pickLastCampaign([c("alpha", "2026-09-06T23:50:00"), c("zeta", "2026-09-07T09:00:00")]),
    ).toBe("zeta");
  });

  test("an unparsable `started` ranks behind every real one, never crashes", () => {
    expect(pickLastCampaign([c("alpha", "yesterday"), c("zeta", "2020-01-01T20:00:00")])).toBe(
      "zeta",
    );
    // …and two unreadable ones stay stable: the alphabetically first id.
    expect(pickLastCampaign([c("zeta", "yesterday"), c("alpha", "yesterday")])).toBe("alpha");
  });

  test("a minute-precise `started` from an older entry still orders", () => {
    expect(
      pickLastCampaign([c("alpha", "2026-09-06T18:00"), c("zeta", "2026-09-06T20:00")]),
    ).toBe("zeta");
  });
});

const scene = (id: string, title: string): SceneSummary => ({
  id,
  title,
  type: "planned",
  status: "ready",
  npcs: [],
  tags: [],
});

const tree: CampaignTree = {
  campaign: "example",
  chapters: [
    { id: "01-salt-harbour", title: "Chapter 1", scenes: [] },
    {
      id: "02-bay",
      title: "Chapter 2",
      scenes: [
        scene("lighthouse-arrival", "Arrival at the lighthouse"),
        scene("smuggler-captured", "Caught by the smugglers"),
      ],
    },
  ],
  npcs: [],
  locations: [
    { id: "lighthouse", name: "The Lighthouse of Salt Harbour" },
  ],
  sessions: [],
};

describe("locationName", () => {
  test("resolves a known id to its name — what a scene's meta line shows", () => {
    expect(locationName(tree, "lighthouse")).toBe("The Lighthouse of Salt Harbour");
  });

  test("an unknown slug passes through unchanged — a scene needs no location", () => {
    expect(locationName(tree, "harbour")).toBe("harbour");
    expect(locationName(undefined, "harbour")).toBe("harbour");
    expect(locationName(tree, undefined)).toBeUndefined();
  });
});

describe("sceneTitle", () => {
  test("finds the title across the chapters", () => {
    expect(sceneTitle(tree, "lighthouse-arrival")).toBe("Arrival at the lighthouse");
    expect(sceneTitle(tree, "smuggler-captured")).toBe("Caught by the smugglers");
  });

  test("degrades to the id when the tree does not know the scene", () => {
    expect(sceneTitle(tree, "gone-for-good")).toBe("gone-for-good");
    expect(sceneTitle(undefined, "lighthouse-arrival")).toBe("lighthouse-arrival");
  });

  test("no scene id at all → nothing to label", () => {
    expect(sceneTitle(tree, undefined)).toBeUndefined();
  });
});

describe("hasScene", () => {
  test("knows the scenes of every chapter, and nothing else", () => {
    expect(hasScene(tree, "smuggler-captured")).toBe(true);
    expect(hasScene(tree, "gone-for-good")).toBe(false);
    expect(hasScene(undefined, "smuggler-captured")).toBe(false);
    expect(hasScene(tree, undefined)).toBe(false);
  });
});

describe("settingsCampaign", () => {
  const list = [c("alpha"), c("zeta", "2026-06-01T18:00:00")];

  test("the campaign the gear came FROM wins over the heuristic", () => {
    // "zeta" is what pickLastCampaign would guess — the DM was in "alpha".
    expect(settingsCampaign("alpha", list)).toBe("alpha");
  });

  test("no origin falls back to the heuristic \"/\" uses", () => {
    expect(settingsCampaign(null, list)).toBe("zeta");
    expect(settingsCampaign("", list)).toBe("zeta");
  });

  test("an origin that is no campaign is ignored — never a row into nothing", () => {
    expect(settingsCampaign("renamed-away", list)).toBe("zeta");
  });

  test("no campaign at all stays undefined — a fresh instance has no back row", () => {
    expect(settingsCampaign("alpha", [])).toBeUndefined();
  });
});
