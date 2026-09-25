import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/types";
import {
  BookA,
  BookMarked,
  BookOpen,
  Bookmark,
  FileText,
  GitFork,
  MapPin,
  NotebookPen,
  User,
} from "lucide-react";

import { translator } from "@/i18n/format";
import { contingencyScenes, kindIcon, kindLabel, resultHref } from "./search";

// The labels come from the catalog and the translator is passed in.
const t = translator("de");
const tEn = translator("en");

describe("kindLabel", () => {
  test("maps the indexed kinds to German labels", () => {
    expect(kindLabel("scene", t)).toBe("Szene");
    expect(kindLabel("npc", t)).toBe("NPC");
    expect(kindLabel("location", t)).toBe("Ort");
    expect(kindLabel("chapter", t)).toBe("Kapitel");
    expect(kindLabel("campaign", t)).toBe("Kampagne");
    expect(kindLabel("session", t)).toBe("Session");
    expect(kindLabel("glossary", t)).toBe("Glossar");
  });

  test("unknown kinds pass through unchanged (degrade, never throw)", () => {
    expect(kindLabel("wat", t)).toBe("wat");
    // …in every language: the kind comes off the wire, the catalog only names
    // the ones it knows.
    expect(kindLabel("wat", tEn)).toBe("wat");
    expect(kindLabel("", t)).toBe("");
  });
});

describe("kindIcon", () => {
  test("one icon per entity kind", () => {
    expect(kindIcon("scene")).toBe(Bookmark);
    expect(kindIcon("npc")).toBe(User);
    expect(kindIcon("location")).toBe(MapPin);
    expect(kindIcon("chapter")).toBe(BookOpen);
    expect(kindIcon("campaign")).toBe(BookMarked);
    expect(kindIcon("session")).toBe(NotebookPen);
    expect(kindIcon("glossary")).toBe(BookA);
  });

  test("contingency scenes get the fork; the flag is ignored for other kinds", () => {
    expect(kindIcon("scene", true)).toBe(GitFork);
    expect(kindIcon("npc", true)).toBe(User);
  });

  test("unknown kinds degrade to a generic entry icon", () => {
    expect(kindIcon("wat")).toBe(FileText);
  });
});

describe("contingencyScenes", () => {
  const tree = {
    campaign: "beispiel",
    chapters: [
      {
        id: "01",
        title: "Kapitel 1",
        scenes: [
          { id: "a", title: "A", type: "planned", status: "ready", npcs: [], tags: [] },
          { id: "b", title: "B", type: "contingency", status: "draft", npcs: [], tags: [] },
        ],
      },
    ],
    npcs: [],
    locations: [],
    sessions: [],
  } satisfies CampaignTree;

  test("collects exactly the contingency scene ids", () => {
    expect(contingencyScenes(tree)).toEqual(new Set(["b"]));
  });

  test("no tree yet -> empty set (icon degrades to bookmark)", () => {
    expect(contingencyScenes(undefined)).toEqual(new Set());
  });
});

describe("resultHref", () => {
  test("a chapter hit opens the chapter's own route by its id", () => {
    expect(resultHref("beispiel", { kind: "chapter", id: "01-salzhafen" })).toBe(
      "/campaigns/beispiel/chapters/01-salzhafen",
    );
    expect(resultHref("beispiel", { kind: "chapter", id: "höhle" })).toBe(
      "/campaigns/beispiel/chapters/h%C3%B6hle",
    );
  });

  test("the campaign hit opens the campaign's route, the chapter overview", () => {
    expect(resultHref("beispiel", { kind: "campaign", id: "beispiel" })).toBe(
      "/campaigns/beispiel",
    );
    expect(resultHref("höhlen kampagne", { kind: "campaign", id: "höhlen kampagne" })).toBe(
      "/campaigns/h%C3%B6hlen%20kampagne",
    );
  });

  // The kinds without a reading view of their own open the page that holds
  // them, named by their id where there is one.
  test("a session opens its reading page", () => {
    expect(resultHref("beispiel", { kind: "session", id: "s-42" })).toBe(
      "/campaigns/beispiel/sessions/s-42",
    );
  });

  test("a term opens the glossary page", () => {
    expect(resultHref("beispiel", { kind: "glossary", id: "salzhafen" })).toBe(
      "/campaigns/beispiel/glossary",
    );
  });

  test("a scene hit opens the scene's own route by its id", () => {
    expect(resultHref("beispiel", { kind: "scene", id: "späh trupp" })).toBe(
      "/campaigns/beispiel/scenes/sp%C3%A4h%20trupp",
    );
  });

  test("an npc hit opens the npc's own route by its id", () => {
    expect(resultHref("beispiel", { kind: "npc", id: "fenn" })).toBe(
      "/campaigns/beispiel/npcs/fenn",
    );
  });

  test("a location hit opens the location's own route by its id", () => {
    expect(resultHref("beispiel", { kind: "location", id: "leuchtturm" })).toBe(
      "/campaigns/beispiel/locations/leuchtturm",
    );
  });
});
