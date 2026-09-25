// Where an npc lives in the app: its reading view, its list, and the context
// line of its reading view.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n";

import { npcHref, npcLabel, npcPageCrumbs, npcsHref } from "./npc-links";

const de = translator("de");
const en = translator("en");

describe("npc links", () => {
  test("the reading view and the list are the npc's own routes", () => {
    expect(npcHref("beispiel", "fenn")).toBe("/campaigns/beispiel/npcs/fenn");
    expect(npcsHref("beispiel")).toBe("/campaigns/beispiel/npcs");
    expect(npcLabel("fenn")).toBe("npcs/fenn");
  });

  test("the reading view points at THE npc list, never at a chapter", () => {
    expect(npcPageCrumbs("beispiel", de)).toEqual([
      { label: "NPCs", to: "/campaigns/beispiel/npcs" },
    ]);
  });

  test("the list label follows the UI language", () => {
    expect(npcPageCrumbs("beispiel", en)).toEqual([
      { label: "NPCs", to: "/campaigns/beispiel/npcs" },
    ]);
  });

  test("the campaign name never appears in the context line", () => {
    expect(npcPageCrumbs("beispiel", de).map((c) => c.label)).not.toContain("beispiel");
  });

  test("no campaign yields nothing", () => {
    expect(npcPageCrumbs("", de)).toEqual([]);
  });
});
