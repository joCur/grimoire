import { describe, expect, test } from "bun:test";

import { navSection } from "./topbar-nav";

/** Only one of the three view shapes is ever set at a time (route match). */
const chapterOverview = { isChapterOverview: true };
const list = (listKind: string) => ({ isChapterOverview: false, listKind });
const file = (filePath: string) => ({ isChapterOverview: false, filePath });

describe("navSection", () => {
  test("the chapter overview is the Kapitel section", () => {
    expect(navSection(chapterOverview)).toBe("chapters");
  });

  test("each browse list marks its own entry; the scene list is Kapitel", () => {
    expect(navSection(list("npcs"))).toBe("npcs");
    expect(navSection(list("locations"))).toBe("locations");
    expect(navSection(list("scenes"))).toBe("chapters");
  });

  test("a scene file belongs under Kapitel — grouped or directly in the chapter", () => {
    expect(navSection(file("01-salzhafen/hafen/ankunft-leuchtturm"))).toBe("chapters");
    expect(navSection(file("01-salzhafen/prolog"))).toBe("chapters");
    expect(navSection(file("01-salzhafen"))).toBe("chapters");
  });

  test("an NPC file is NPCs and a location file is Orte, whatever mentions them", () => {
    expect(navSection(file("npcs/fenn"))).toBe("npcs");
    expect(navSection(file("locations/leuchtturm"))).toBe("locations");
  });

  test("views that belong to no section are marked nowhere", () => {
    expect(navSection({ isChapterOverview: false })).toBeUndefined(); // generator, review
    expect(navSection(file("campaign"))).toBeUndefined();
    expect(navSection(file("sessions/2026-01-15"))).toBeUndefined();
    expect(navSection(file("inbox"))).toBeUndefined();
    expect(navSection(file("glossary"))).toBeUndefined();
  });

  test("degrades: an unknown list kind or an unusable path marks nothing", () => {
    expect(navSection(list("dragons"))).toBeUndefined();
    expect(navSection(file(""))).toBeUndefined();
    expect(navSection(file("npcs"))).toBeUndefined();
  });
});
