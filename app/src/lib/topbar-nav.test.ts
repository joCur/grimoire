import { describe, expect, test } from "bun:test";

import { navSection } from "./topbar-nav";

/** Only one of the view shapes is ever set at a time (route match). */
const chapterOverview = { isChapterOverview: true };
const npcs = { isChapterOverview: false, isNpcs: true };
const locations = { isChapterOverview: false, isLocations: true };
const list = (listKind: string) => ({ isChapterOverview: false, listKind });
const chapter = { isChapterOverview: false, isChapter: true };
const scene = { isChapterOverview: false, isScene: true };

describe("navSection", () => {
  test("the chapter overview is the Kapitel section", () => {
    expect(navSection(chapterOverview)).toBe("chapters");
  });

  test("the scene list is Kapitel", () => {
    expect(navSection(list("scenes"))).toBe("chapters");
  });

  test("the reading views of a chapter and a scene belong under Kapitel", () => {
    expect(navSection(chapter)).toBe("chapters");
    expect(navSection(scene)).toBe("chapters");
  });

  test("an npc's own routes — its list and its reading view — are NPCs", () => {
    expect(navSection(npcs)).toBe("npcs");
  });

  test("a location's own routes — its list and its reading view — are Orte", () => {
    expect(navSection(locations)).toBe("locations");
  });

  test("views that belong to no section are marked nowhere", () => {
    // Generator, review, a session, the glossary.
    expect(navSection({ isChapterOverview: false })).toBeUndefined();
  });

  test("degrades: an unknown list kind marks nothing", () => {
    expect(navSection(list("dragons"))).toBeUndefined();
    // The npc list lives at its own route, not under `list/`.
    expect(navSection(list("npcs"))).toBeUndefined();
  });
});
