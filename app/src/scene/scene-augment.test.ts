// A scene's augment proposal, field by field: what is listed, and which
// default each listed field starts with.

import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";

import { sceneFieldProposals } from "./scene-augment";

const CURRENT: SceneProposal = {
  id: "arrival",
  title: "Arrival",
  type: "planned",
  chapter: "01-salt-harbour",
  location: "lighthouse",
  npcs: ["jorna"],
  handouts: [],
  tags: ["social"],
  status: "draft",
  body: "## Flow\n",
};

describe("sceneFieldProposals", () => {
  test("a proposal that repeats the scene lists nothing", () => {
    expect(sceneFieldProposals(CURRENT, { ...CURRENT })).toEqual([]);
  });

  test("a value where the scene has none is new — and preselected", () => {
    expect(
      sceneFieldProposals(CURRENT, { ...CURRENT, handouts: ["Map"], trigger: "when night falls" }),
    ).toEqual([
      { key: "handouts", current: [], proposed: ["Map"], state: "new" },
      { key: "trigger", proposed: "when night falls", state: "new" },
    ]);
  });

  test("a different value is a change, the stored one beside it", () => {
    expect(
      sceneFieldProposals(CURRENT, { ...CURRENT, npcs: ["fenn", "jorna"], status: "ready" }),
    ).toEqual([
      { key: "npcs", current: ["jorna"], proposed: ["fenn", "jorna"], state: "changed" },
      { key: "status", current: "draft", proposed: "ready", state: "changed" },
    ]);
  });

  test("an emptied field is no deletion, and the id and text are no field here", () => {
    const { location: _location, ...withoutLocation } = CURRENT;
    expect(
      sceneFieldProposals(CURRENT, { ...withoutLocation, tags: [], id: "new", body: "## Different\n" }),
    ).toEqual([]);
  });
});
