import { describe, expect, test } from "bun:test";
import { NPC_STATUSES } from "@grimoire/shared/types";

import { browseListTitle, entityHeaderKind, npcStatusLabel } from "./entity";

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
    expect(npcStatusLabel("alive")).toBe("lebendig");
    expect(npcStatusLabel("dead")).toBe("tot");
    expect(npcStatusLabel("missing")).toBe("vermisst");
    expect(npcStatusLabel("unknown")).toBe("unbekannt");
  });

  test("every known status of the format has a label", () => {
    for (const status of NPC_STATUSES) {
      expect(npcStatusLabel(status)).not.toBe(status);
    }
  });

  test("case and surrounding whitespace do not matter", () => {
    expect(npcStatusLabel(" Alive ")).toBe("lebendig");
  });

  test("unknown values pass through verbatim (degrade)", () => {
    expect(npcStatusLabel("verschollen im Nebel")).toBe("verschollen im Nebel");
    expect(npcStatusLabel("")).toBe("");
  });
});

describe("browseListTitle", () => {
  test("the three list pages have German titles", () => {
    expect(browseListTitle("scenes")).toBe("Szenen");
    expect(browseListTitle("npcs")).toBe("NPCs");
    expect(browseListTitle("locations")).toBe("Orte");
  });

  test("a kind without a list has no title (the page says so)", () => {
    expect(browseListTitle("dragons")).toBeUndefined();
    expect(browseListTitle("")).toBeUndefined();
  });
});
