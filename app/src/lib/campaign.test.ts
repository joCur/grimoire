import { describe, expect, test } from "bun:test";
import type { CampaignSummary, CampaignTree, SceneSummary } from "@grimoire/shared/types";

import { locationName, pickLastCampaign, sceneTitle } from "./campaign";

/**
 * A campaign whose newest session STARTED at `lastSessionStarted`. The
 * session's own id is opaque noise since issue #58 and deliberately random
 * here — nothing in the order may read it.
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
    expect(pickLastCampaign([c("beispiel", "2026-01-15T19:30:00")])).toBe("beispiel");
    expect(pickLastCampaign([c("beispiel")])).toBe("beispiel");
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

  test("two sessions of the SAME DAY order by their TIME, not by their id (#58)", () => {
    // The ids say nothing about the order — the evening's second session
    // simply started later. (Under the old scheme this was `-2` vs `-10` and
    // the app had to know that `-10` is the newer one.)
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
    expect(pickLastCampaign([c("alpha", "gestern"), c("zeta", "2020-01-01T20:00:00")])).toBe(
      "zeta",
    );
    // …and two unreadable ones stay stable: the alphabetically first id.
    expect(pickLastCampaign([c("zeta", "gestern"), c("alpha", "gestern")])).toBe("alpha");
  });

  test("a minute-precise `started` from an older file still orders", () => {
    expect(
      pickLastCampaign([c("alpha", "2026-09-06T18:00"), c("zeta", "2026-09-06T20:00")]),
    ).toBe("zeta");
  });
});

const scene = (id: string, title: string): SceneSummary => ({
  path: `01-salzhafen/hafen/${id}`,
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
    { path: "locations/leuchtturm", id: "leuchtturm", name: "Der Leuchtturm von Salzhafen" },
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
