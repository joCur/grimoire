import { describe, expect, test } from "bun:test";
import {
  NPC_STATUSES,
  type EntryResponse,
  type Location,
  type NpcStatus,
} from "@grimoire/shared/types";

import { entryPatchBody } from "@/api";
import { translator } from "@/i18n/format";
import {
  browseListTitle,
  entityHeaderKind,
  entryFieldValues,
  entryId,
  entryName,
  npcStatusLabel,
} from "./entity";

// A location is its own typed entry (ADR #31); the other kinds carry their
// fields under `properties`.
const TOWER: Location = {
  kind: "location",
  id: "leuchtturm",
  path: "locations/leuchtturm",
  name: "Der Leuchtturm",
  atmosphere: "Verlassen in Eile.",
  body: "## Beim ersten Betreten\n",
  rev: 3,
};
const CHAPTER: EntryResponse = {
  kind: "chapter",
  path: "01-salzhafen",
  properties: { id: "01-salzhafen", title: "Salzhafen", status: "active" },
  body: "",
  rev: 1,
};

describe("reading any entry", () => {
  test("id, display name and fields, whatever the kind", () => {
    expect(entryId(TOWER)).toBe("leuchtturm");
    expect(entryName(TOWER)).toBe("Der Leuchtturm");
    // A location's fields by name — its id included, never kind/path/body/rev.
    expect(entryFieldValues(TOWER)).toEqual({
      id: "leuchtturm",
      name: "Der Leuchtturm",
      atmosphere: "Verlassen in Eile.",
    });
    expect(entryId(CHAPTER)).toBe("01-salzhafen");
    expect(entryName(CHAPTER)).toBe("Salzhafen");
    expect(entryFieldValues(CHAPTER)).toBe(CHAPTER.properties);
  });

  test("the write travels in the kind's own shape", () => {
    const request = { rev: 3, properties: { name: "Turm", chapter: null }, body: "x" };
    expect(entryPatchBody(TOWER.path, request)).toEqual({
      rev: 3,
      name: "Turm",
      chapter: null,
      body: "x",
    });
    expect(entryPatchBody(CHAPTER.path, request)).toEqual(request);
  });
});

// The labels come from the catalog and the translator is passed in, so a test
// says which language it asserts.
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

  test("a value from outside the four is not a status at all", () => {
    // `unknown` above is one of the four — the NPC nobody has placed yet — and
    // the only other case there could be is a foreign value, which the column
    // cannot hold (ADR #25). The type is what says so.
    // @ts-expect-error not one of alive | dead | missing | unknown
    const foreign: NpcStatus = "verschollen im Nebel";
    expect(NPC_STATUSES as readonly string[]).not.toContain(foreign);
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
