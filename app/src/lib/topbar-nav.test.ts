import { describe, expect, test } from "bun:test";

import { navSection } from "./topbar-nav";

/** Only one of the three view shapes is ever set at a time (route match). */
const chapterOverview = { isChapterOverview: true };
const list = (listKind: string) => ({ isChapterOverview: false, listKind });
const entry = (entryPath: string) => ({ isChapterOverview: false, entryPath });

describe("navSection", () => {
  test("the chapter overview is the Kapitel section", () => {
    expect(navSection(chapterOverview)).toBe("chapters");
  });

  test("each browse list marks its own entry; the scene list is Kapitel", () => {
    expect(navSection(list("npcs"))).toBe("npcs");
    expect(navSection(list("locations"))).toBe("locations");
    expect(navSection(list("scenes"))).toBe("chapters");
  });

  test("a scene entry belongs under Kapitel — grouped or directly in the chapter", () => {
    expect(navSection(entry("01-salzhafen/hafen/ankunft-leuchtturm"))).toBe("chapters");
    expect(navSection(entry("01-salzhafen/prolog"))).toBe("chapters");
    expect(navSection(entry("01-salzhafen"))).toBe("chapters");
  });

  test("an NPC entry is NPCs and a location entry is Orte, whatever mentions them", () => {
    expect(navSection(entry("npcs/fenn"))).toBe("npcs");
    expect(navSection(entry("locations/leuchtturm"))).toBe("locations");
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
    expect(navSection(entry(""))).toBeUndefined();
    expect(navSection(entry("npcs"))).toBeUndefined();
  });
});
