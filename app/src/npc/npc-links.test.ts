// Where an npc lives in the app: its reading view and its list.

import { describe, expect, test } from "bun:test";

import { npcHref, npcLabel, npcsHref } from "./npc-links";

describe("npc links", () => {
  test("the reading view and the list are the npc's own routes", () => {
    expect(npcHref("example", "fenn")).toBe("/campaigns/example/npcs/fenn");
    expect(npcsHref("example")).toBe("/campaigns/example/npcs");
    expect(npcLabel("fenn")).toBe("npcs/fenn");
  });
});
