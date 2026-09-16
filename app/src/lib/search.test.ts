import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/types";
import { BookMarked, BookOpen, Bookmark, FileText, GitFork, MapPin, User } from "lucide-react";

import { translator } from "@/i18n/format";
import { contingencyPaths, kindIcon, kindLabel, resultHref } from "./search";

// The labels come from the catalog and the translator is passed in (issue #69).
const t = translator("de");
const tEn = translator("en");

describe("kindLabel", () => {
  test("maps the indexed kinds to German labels", () => {
    expect(kindLabel("scene", t)).toBe("Szene");
    expect(kindLabel("npc", t)).toBe("NPC");
    expect(kindLabel("location", t)).toBe("Ort");
    expect(kindLabel("chapter", t)).toBe("Kapitel");
    expect(kindLabel("campaign", t)).toBe("Kampagne");
  });

  test("unknown kinds pass through unchanged (degrade, never throw)", () => {
    expect(kindLabel("glossary", t)).toBe("glossary");
    // …in every language: the kind comes off the wire, the catalog only names
    // the five it knows.
    expect(kindLabel("glossary", tEn)).toBe("glossary");
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
  });

  test("contingency scenes get the fork; the flag is ignored for other kinds", () => {
    expect(kindIcon("scene", true)).toBe(GitFork);
    expect(kindIcon("npc", true)).toBe(User);
  });

  test("unknown kinds degrade to a generic file icon", () => {
    expect(kindIcon("session")).toBe(FileText);
  });
});

describe("contingencyPaths", () => {
  const tree = {
    campaign: "beispiel",
    chapters: [
      {
        id: "01",
        title: "Kapitel 1",
        groups: [
          { slug: "hafen", name: "hafen",
            scenes: [
              { path: "01/hafen/a", id: "a", title: "A", type: "planned", status: "ready", npcs: [], tags: [] },
              { path: "01/hafen/b", id: "b", title: "B", type: "contingency", status: "draft", npcs: [], tags: [] },
            ],
          },
        ],
      },
    ],
    npcs: [],
    locations: [],
    sessions: [],
  } satisfies CampaignTree;

  test("collects exactly the contingency scene paths", () => {
    expect(contingencyPaths(tree)).toEqual(new Set(["01/hafen/b"]));
  });

  test("no tree yet -> empty set (icon degrades to bookmark)", () => {
    expect(contingencyPaths(undefined)).toEqual(new Set());
  });
});

describe("resultHref", () => {
  test("routes every file-backed kind to the file view", () => {
    expect(resultHref("beispiel", { kind: "npc", path: "npcs/fenn" })).toBe(
      "/beispiel/entry/npcs/fenn",
    );
    expect(resultHref("beispiel", { kind: "chapter", path: "01-salzhafen" })).toBe(
      "/beispiel/entry/01-salzhafen",
    );
  });

  test("the campaign itself opens the pool, not a file view", () => {
    expect(resultHref("beispiel", { kind: "campaign", path: "campaign" })).toBe("/beispiel");
    expect(resultHref("höhlen kampagne", { kind: "campaign", path: "campaign" })).toBe(
      "/h%C3%B6hlen%20kampagne",
    );
  });

  test("encodes path segments but keeps the slashes routable", () => {
    const result = { kind: "scene", path: "01-salzhafen/höhle/späh trupp" } as const;
    expect(resultHref("beispiel", result)).toBe(
      "/beispiel/entry/01-salzhafen/h%C3%B6hle/sp%C3%A4h%20trupp",
    );
  });
});
