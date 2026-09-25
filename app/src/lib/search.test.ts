import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/types";
import {
  BookA,
  BookMarked,
  BookOpen,
  Bookmark,
  FileText,
  GitFork,
  Inbox,
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
    // The three that are lists, not entries — they are searchable too.
    expect(kindLabel("session", t)).toBe("Session");
    expect(kindLabel("inbox", t)).toBe("Idee");
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
    expect(kindIcon("inbox")).toBe(Inbox);
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
  test("routes every entry kind to the reading view", () => {
    expect(
      resultHref("beispiel", { kind: "chapter", id: "01-salzhafen", path: "01-salzhafen" }),
    ).toBe("/campaigns/beispiel/entries/01-salzhafen");
  });

  test("the campaign itself opens the chapter overview, not the reading view", () => {
    expect(resultHref("beispiel", { kind: "campaign", id: "campaign", path: "campaign" })).toBe(
      "/campaigns/beispiel",
    );
    expect(
      resultHref("höhlen kampagne", { kind: "campaign", id: "campaign", path: "campaign" }),
    ).toBe("/campaigns/h%C3%B6hlen%20kampagne");
  });

  test("encodes the chapter's address", () => {
    const result = { kind: "chapter", id: "höhle", path: "höhle" } as const;
    expect(resultHref("beispiel", result)).toBe("/campaigns/beispiel/entries/h%C3%B6hle");
  });

  // The three kinds that have no entry address any more: they open the page
  // that holds them, named by their id where there is one.
  test("a session opens its reading page", () => {
    expect(resultHref("beispiel", { kind: "session", id: "s-42" })).toBe(
      "/campaigns/beispiel/sessions/s-42",
    );
  });

  test("an idea opens the wrap-up, a term the glossary page", () => {
    expect(resultHref("beispiel", { kind: "inbox", id: "i-1" })).toBe("/campaigns/beispiel/review");
    expect(resultHref("beispiel", { kind: "glossary", id: "salzhafen" })).toBe(
      "/campaigns/beispiel/glossary",
    );
  });

  test("a chapter hit without a path falls back to the chapter overview", () => {
    expect(resultHref("beispiel", { kind: "chapter", id: "01-salzhafen" })).toBe(
      "/campaigns/beispiel",
    );
  });

  test("a scene hit opens the scene's own route by its id — no address needed", () => {
    expect(resultHref("beispiel", { kind: "scene", id: "späh trupp" })).toBe(
      "/campaigns/beispiel/scenes/sp%C3%A4h%20trupp",
    );
  });

  test("an npc hit opens the npc's own route by its id — no address needed", () => {
    expect(resultHref("beispiel", { kind: "npc", id: "fenn" })).toBe(
      "/campaigns/beispiel/npcs/fenn",
    );
  });

  test("a location hit opens the location's own route by its id — no address needed", () => {
    expect(resultHref("beispiel", { kind: "location", id: "leuchtturm" })).toBe(
      "/campaigns/beispiel/locations/leuchtturm",
    );
  });
});
