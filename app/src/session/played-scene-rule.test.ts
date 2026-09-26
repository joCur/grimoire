import { describe, expect, test } from "bun:test";

import { leavesScenePlayed, playedSceneIds } from "./played-scene-rule";

const note = (id: string, sceneId?: string) => ({
  id,
  at: "19:30",
  ...(sceneId === undefined ? {} : { sceneId }),
  text: "Notiz",
  reviewed: false,
  rev: 1,
});
const played = (id: string, sceneId: string) => ({ id, sceneId, rev: 1 });

describe("leavesScenePlayed", () => {
  test("a note taken in the scene: leaving it records it as played", () => {
    expect(leavesScenePlayed({ log: [note("n1", "harbor")], playedScenes: [] }, "harbor")).toBe(true);
  });

  test("no note in the scene: leaving it records nothing", () => {
    expect(leavesScenePlayed({ log: [], playedScenes: [] }, "harbor")).toBe(false);
    expect(
      leavesScenePlayed({ log: [note("n1", "tower"), note("n2")], playedScenes: [] }, "harbor"),
    ).toBe(false);
  });

  test("a scene already played in this session is not recorded twice", () => {
    expect(
      leavesScenePlayed(
        { log: [note("n1", "harbor")], playedScenes: [played("p1", "harbor")] },
        "harbor",
      ),
    ).toBe(false);
  });
});

describe("playedSceneIds", () => {
  test("the scenes in the order they were played", () => {
    expect(
      playedSceneIds({ playedScenes: [played("p1", "harbor"), played("p2", "tower")] }),
    ).toEqual(["harbor", "tower"]);
  });
});
