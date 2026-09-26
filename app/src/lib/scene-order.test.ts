// The rules both views read out of the chapter's scene order (ADR #27):
// which scene a move trades places with, which scene the session view opens
// with, and where its "next scene" step leads.
//
// Pure functions, tested without a render — the two views share these rules,
// so they are checked once, here.

import type { CampaignTree, SceneSummary } from "@grimoire/shared/campaign-tree";
import type { SceneStatus, SceneType } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";

import {
  contingencyScenes,
  initialSessionScene,
  moveSceneOrder,
  nextSessionScene,
  plannedScenes,
  withSceneOrder,
  withSceneOrderRev,
} from "./scene-order";

function scene(id: string, type: SceneType = "planned", status: SceneStatus = "ready"): SceneSummary {
  return { id, title: id, type, status, npcs: [], tags: [] };
}

/** The order as the endpoint would receive it. */
const ids = (scenes: readonly SceneSummary[]): string[] => scenes.map((s) => s.id);

describe("the two blocks of a chapter", () => {
  const scenes = [scene("a"), scene("notfall", "contingency"), scene("b")];

  test("the plan keeps its order, contingencies are their own block", () => {
    expect(ids(plannedScenes(scenes))).toEqual(["a", "b"]);
    expect(ids(contingencyScenes(scenes))).toEqual(["notfall"]);
  });
});

describe("moveSceneOrder", () => {
  test("a step swaps two neighbours and writes the WHOLE order", () => {
    const scenes = [scene("a"), scene("b"), scene("c")];
    expect(moveSceneOrder(scenes, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveSceneOrder(scenes, "b", 1)).toEqual(["a", "c", "b"]);
  });

  test("the swap skips the other block instead of trading a plan for a contingency", () => {
    // `pos` runs over both blocks; the DM sees two lists. Moving "b" up has to
    // reach "a" — swapping with the contingency between them would move
    // nothing on screen.
    const scenes = [scene("a"), scene("notfall", "contingency"), scene("b")];
    expect(moveSceneOrder(scenes, "b", -1)).toEqual(["b", "notfall", "a"]);
  });

  test("a contingency moves within its own block", () => {
    const scenes = [
      scene("erst", "contingency"),
      scene("a"),
      scene("dann", "contingency"),
    ];
    expect(moveSceneOrder(scenes, "dann", -1)).toEqual(["dann", "a", "erst"]);
  });

  test("the ends of a block have nowhere to go — the order comes back unchanged", () => {
    const scenes = [scene("a"), scene("b"), scene("notfall", "contingency")];
    expect(moveSceneOrder(scenes, "a", -1)).toEqual(["a", "b", "notfall"]);
    expect(moveSceneOrder(scenes, "b", 1)).toEqual(["a", "b", "notfall"]);
    expect(moveSceneOrder(scenes, "notfall", 1)).toEqual(["a", "b", "notfall"]);
    expect(moveSceneOrder(scenes, "notfall", -1)).toEqual(["a", "b", "notfall"]);
  });

  test("an id the chapter does not hold writes nothing new", () => {
    const scenes = [scene("a"), scene("b")];
    expect(moveSceneOrder(scenes, "fremd", 1)).toEqual(["a", "b"]);
  });
});

describe("initialSessionScene", () => {
  test("the first scene of the order that is not behind us", () => {
    const scenes = [scene("a", "planned", "played"), scene("b"), scene("c")];
    expect(initialSessionScene(scenes)?.id).toBe("b");
  });

  test("a dropped scene counts as behind us too", () => {
    const scenes = [scene("a", "planned", "dropped"), scene("b")];
    expect(initialSessionScene(scenes)?.id).toBe("b");
  });

  test("a contingency is never the entry, however early it sits", () => {
    // The evening never starts on a detour: the step past the played scene is
    // the next PLANNED one, not the contingency in between.
    const scenes = [
      scene("a", "planned", "played"),
      scene("notfall", "contingency"),
      scene("b"),
      scene("c"),
    ];
    expect(initialSessionScene(scenes)?.id).toBe("b");
  });

  test("with the plan played the view opens on its first scene, not on nothing", () => {
    const scenes = [
      scene("a", "planned", "played"),
      scene("notfall", "contingency"),
      scene("b", "planned", "dropped"),
    ];
    expect(initialSessionScene(scenes)?.id).toBe("a");
  });

  test("a chapter without a planned scene has none", () => {
    expect(initialSessionScene([])).toBeUndefined();
    expect(initialSessionScene([scene("notfall", "contingency")])).toBeUndefined();
  });
});

describe("nextSessionScene", () => {
  test("the next PLANNED scene of the order that is still open", () => {
    const scenes = [scene("a"), scene("notfall", "contingency"), scene("b")];
    expect(nextSessionScene(scenes, "a")?.id).toBe("b");
  });

  test("scenes already behind us are skipped", () => {
    const scenes = [scene("a"), scene("b", "planned", "played"), scene("c")];
    expect(nextSessionScene(scenes, "a")?.id).toBe("c");
  });

  test("from a contingency the step picks the plan back up at its start", () => {
    const scenes = [
      scene("a", "planned", "played"),
      scene("notfall", "contingency"),
      scene("b"),
    ];
    expect(nextSessionScene(scenes, "notfall")?.id).toBe("b");
  });

  test("from a contingency ahead of the plan the step is the plan's first open scene", () => {
    const scenes = [
      scene("notfall", "contingency"),
      scene("a", "planned", "played"),
      scene("b"),
    ];
    expect(nextSessionScene(scenes, "notfall")?.id).toBe("b");
  });

  test("nothing left to play means no step at all", () => {
    const scenes = [scene("a"), scene("notfall", "contingency")];
    expect(nextSessionScene(scenes, "a")).toBeUndefined();
    expect(nextSessionScene([], undefined)).toBeUndefined();
  });
});

describe("the optimistic half", () => {
  const tree: CampaignTree = {
    campaign: "beispiel",
    chapters: [
      { id: "01", title: "Kapitel 1", sceneOrderRev: 3, scenes: [scene("a"), scene("b")] },
      { id: "02", title: "Kapitel 2", sceneOrderRev: 7, scenes: [scene("c")] },
    ],
    npcs: [],
    locations: [],
    sessions: [],
  };

  test("only the named chapter is rearranged", () => {
    const next = withSceneOrder(tree, "01", ["b", "a"]);
    expect(ids(next.chapters[0]?.scenes ?? [])).toEqual(["b", "a"]);
    expect(ids(next.chapters[1]?.scenes ?? [])).toEqual(["c"]);
  });

  test("a scene the order does not name is kept rather than dropped", () => {
    const next = withSceneOrder(tree, "01", ["b", "fremd"]);
    expect(ids(next.chapters[0]?.scenes ?? [])).toEqual(["b", "a"]);
  });

  test("the fresh guard token lands on its own chapter", () => {
    const next = withSceneOrderRev(tree, "01", 4);
    expect(next.chapters[0]?.sceneOrderRev).toBe(4);
    expect(next.chapters[1]?.sceneOrderRev).toBe(7);
  });
});
