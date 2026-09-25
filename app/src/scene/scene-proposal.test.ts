import type { SceneProposal } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { sceneOf } from "./scene-proposal";

const PROPOSED: SceneProposal = {
  id: "ankunft",
  title: "Ankunft",
  type: "planned",
  chapter: "01-salzhafen",
  location: "leuchtturm",
  npcs: [],
  handouts: [],
  tags: [],
  status: "draft",
  body: "## Flow\n",
};

describe("sceneOf", () => {
  test("without changes the proposal stands as the run wrote it", () => {
    expect(sceneOf(PROPOSED)).toEqual(PROPOSED);
    expect(sceneOf(PROPOSED, undefined, undefined)).toEqual(PROPOSED);
  });

  test("changes lie on top in order — the typing buffer last", () => {
    const scene = sceneOf(
      PROPOSED,
      { title: "Auf dem Job", body: "## Anders\n" },
      { title: "Im Puffer" },
    );
    expect(scene.title).toBe("Im Puffer");
    expect(scene.body).toBe("## Anders\n");
    expect(scene.status).toBe("draft");
  });

  test("null clears an optional field instead of storing an empty value", () => {
    expect("location" in sceneOf(PROPOSED, { location: null })).toBe(false);
  });
});
