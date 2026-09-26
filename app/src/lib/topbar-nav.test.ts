import { describe, expect, test } from "bun:test";

import { navSection } from "./topbar-nav";

/** Only one of the view shapes is ever set at a time (route match). */
const chapterOverview = { isChapterOverview: true };
const npcs = { isChapterOverview: false, isNpcs: true };
const locations = { isChapterOverview: false, isLocations: true };
const chapter = { isChapterOverview: false, isChapter: true };
const scenes = { isChapterOverview: false, isScenes: true };

describe("navSection", () => {
  test("the chapter overview is the Kapitel section", () => {
    expect(navSection(chapterOverview)).toBe("chapters");
  });

  test("a chapter's reading view and a scene's own routes belong under Kapitel", () => {
    expect(navSection(chapter)).toBe("chapters");
    expect(navSection(scenes)).toBe("chapters");
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
});
