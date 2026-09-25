import { describe, expect, test } from "bun:test";

import { navSection } from "./topbar-nav";

/** Only one of the view shapes is ever set at a time (route match). */
const chapterOverview = { isChapterOverview: true };
const npcs = { isChapterOverview: false, isNpcs: true };
const locations = { isChapterOverview: false, isLocations: true };
const list = (listKind: string) => ({ isChapterOverview: false, listKind });
const entry = (entryPath: string) => ({ isChapterOverview: false, entryPath });
const scene = { isChapterOverview: false, isScene: true };

describe("navSection", () => {
  test("the chapter overview is the Kapitel section", () => {
    expect(navSection(chapterOverview)).toBe("chapters");
  });

  test("the scene list is Kapitel", () => {
    expect(navSection(list("scenes"))).toBe("chapters");
  });

  test("a scene's reading view and a chapter belong under Kapitel", () => {
    expect(navSection(scene)).toBe("chapters");
    expect(navSection(entry("01-salzhafen"))).toBe("chapters");
    // The address schema has no scene: an entry path naming one marks nothing.
    expect(navSection(entry("01-salzhafen/prolog"))).toBeUndefined();
  });

  test("an npc's own routes — its list and its reading view — are NPCs", () => {
    expect(navSection(npcs)).toBe("npcs");
    // The address schema has no npc: an entry path naming one marks nothing.
    expect(navSection(entry("npcs/fenn"))).toBeUndefined();
  });

  test("a location's own routes — its list and its reading view — are Orte", () => {
    expect(navSection(locations)).toBe("locations");
    // The address schema has no location: an entry path naming one marks nothing.
    expect(navSection(entry("locations/leuchtturm"))).toBeUndefined();
  });

  test("views that belong to no section are marked nowhere", () => {
    expect(navSection({ isChapterOverview: false })).toBeUndefined(); // generator, review
    expect(navSection(entry("campaign"))).toBeUndefined();
    expect(navSection(entry("sessions/2026-01-15"))).toBeUndefined();
    expect(navSection(entry("inbox"))).toBeUndefined();
    expect(navSection(entry("glossary"))).toBeUndefined();
  });

  test("degrades: an unknown list kind or an unusable path marks nothing", () => {
    expect(navSection(list("dragons"))).toBeUndefined();
    // The npc list lives at its own route, not under `list/`.
    expect(navSection(list("npcs"))).toBeUndefined();
    expect(navSection(entry(""))).toBeUndefined();
    expect(navSection(entry("npcs"))).toBeUndefined();
  });
});
