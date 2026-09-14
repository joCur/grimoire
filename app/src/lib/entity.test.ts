import { describe, expect, test } from "bun:test";
import { NPC_STATUSES } from "@grimoire/shared/types";

import { translator } from "@/i18n/format";
import { browseListTitle, entityHeaderKind, npcStatusLabel } from "./entity";

// The labels come from the catalog and the translator is passed in (issue
// #69) — so a test says which language it asserts.
const t = translator("de");
const tEn = translator("en");

describe("entityHeaderKind", () => {
  test("scene keeps the scene article", () => {
    expect(entityHeaderKind("scene")).toBe("scene");
  });

  test("npc and location get their own headers", () => {
    expect(entityHeaderKind("npc")).toBe("npc");
    expect(entityHeaderKind("location")).toBe("location");
  });

  test("everything else is a plain titled header — never the scene overline", () => {
    for (const kind of ["chapter", "campaign", "session", "inbox", "glossary", "unknown"] as const) {
      expect(entityHeaderKind(kind)).toBe("titled");
    }
  });
});

describe("npcStatusLabel", () => {
  test("known statuses map to German labels", () => {
    expect(npcStatusLabel("alive", t)).toBe("Lebendig");
    expect(npcStatusLabel("dead", t)).toBe("Tot");
    expect(npcStatusLabel("missing", t)).toBe("Vermisst");
    expect(npcStatusLabel("unknown", t)).toBe("Unbekannt");
  });

  test("every known status of the format has a label", () => {
    for (const status of NPC_STATUSES) {
      expect(npcStatusLabel(status, t)).not.toBe(status);
    }
  });

  test("case and surrounding whitespace do not matter", () => {
    expect(npcStatusLabel(" Alive ", t)).toBe("Lebendig");
  });

  test("unknown values pass through verbatim (degrade)", () => {
    expect(npcStatusLabel("verschollen im Nebel", t)).toBe("verschollen im Nebel");
    expect(npcStatusLabel("", t)).toBe("");
  });
});

describe("browseListTitle", () => {
  test("the three list pages have German titles", () => {
    expect(browseListTitle("scenes", t)).toBe("Szenen");
    expect(browseListTitle("npcs", t)).toBe("NPCs");
    expect(browseListTitle("locations", t)).toBe("Orte");
  });

  test("a kind without a list has no title (the page says so)", () => {
    expect(browseListTitle("dragons", t)).toBeUndefined();
    expect(browseListTitle("", t)).toBeUndefined();
  });
});
