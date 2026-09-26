// Where an npc lives in the app: its reading view, its list, and the context
// line of its reading view.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n";

import { npcHref, npcLabel, npcPageCrumbs, npcsHref } from "./npc-links";

const de = translator("de");
const en = translator("en");

describe("npc links", () => {
  test("the reading view and the list are the npc's own routes", () => {
    expect(npcHref("example", "fenn")).toBe("/campaigns/example/npcs/fenn");
    expect(npcsHref("example")).toBe("/campaigns/example/npcs");
    expect(npcLabel("fenn")).toBe("npcs/fenn");
  });

  test("the reading view points at THE npc list, never at a chapter", () => {
    expect(npcPageCrumbs("example", de)).toEqual([
      { label: de("browse.title.npcs"), to: "/campaigns/example/npcs" },
    ]);
  });

  test("the list label follows the UI language", () => {
    expect(npcPageCrumbs("example", en)).toEqual([
      { label: en("browse.title.npcs"), to: "/campaigns/example/npcs" },
    ]);
  });

  test("the campaign name never appears in the context line", () => {
    expect(npcPageCrumbs("example", de).map((c) => c.label)).not.toContain("example");
  });

  test("no campaign yields nothing", () => {
    expect(npcPageCrumbs("", de)).toEqual([]);
  });
});
