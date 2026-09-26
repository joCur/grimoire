import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";

import { sceneOf } from "./scene-proposal";

const PROPOSED: SceneProposal = {
  id: "arrival",
  title: "Arrival",
  type: "planned",
  chapter: "01-salt-harbour",
  location: "lighthouse",
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
      { title: "On the job", body: "## Different\n" },
      { title: "In the buffer" },
    );
    expect(scene.title).toBe("In the buffer");
    expect(scene.body).toBe("## Different\n");
    expect(scene.status).toBe("draft");
  });

  test("null clears an optional field instead of storing an empty value", () => {
    expect("location" in sceneOf(PROPOSED, { location: null })).toBe(false);
  });
});
