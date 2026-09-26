import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";
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
  test("maps the indexed kinds to their catalog labels", () => {
    expect(kindLabel("scene", t)).toBe(t("kind.scene"));
    expect(kindLabel("npc", t)).toBe(t("kind.npc"));
    expect(kindLabel("location", t)).toBe(t("kind.location"));
    expect(kindLabel("chapter", t)).toBe(t("kind.chapter"));
    expect(kindLabel("campaign", t)).toBe(t("kind.campaign"));
    expect(kindLabel("session", t)).toBe(t("kind.session"));
    expect(kindLabel("glossary-term", t)).toBe(t("kind.glossary"));
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
    expect(kindIcon("glossary-term")).toBe(BookA);
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
    campaign: "example",
    chapters: [
      {
        id: "01",
        title: "Chapter 1",
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
    expect(resultHref("example", { kind: "chapter", id: "01-salt-harbour" })).toBe(
      "/campaigns/example/chapters/01-salt-harbour",
    );
    expect(resultHref("example", { kind: "chapter", id: "café" })).toBe(
      "/campaigns/example/chapters/caf%C3%A9",
    );
  });

  test("the campaign hit opens the campaign's route, the chapter overview", () => {
    expect(resultHref("example", { kind: "campaign", id: "example" })).toBe(
      "/campaigns/example",
    );
    expect(resultHref("café campaign", { kind: "campaign", id: "café campaign" })).toBe(
      "/campaigns/caf%C3%A9%20campaign",
    );
  });

  // The kinds without a reading view of their own open the page that holds
  // them, named by their id where there is one.
  test("a session opens its reading page", () => {
    expect(resultHref("example", { kind: "session", id: "s-42" })).toBe(
      "/campaigns/example/sessions/s-42",
    );
  });

  test("a term opens the glossary page", () => {
    expect(resultHref("example", { kind: "glossary-term", id: "salt-harbour" })).toBe(
      "/campaigns/example/glossary",
    );
  });

  test("a scene hit opens the scene's own route by its id", () => {
    expect(resultHref("example", { kind: "scene", id: "naïve scout" })).toBe(
      "/campaigns/example/scenes/na%C3%AFve%20scout",
    );
  });

  test("an npc hit opens the npc's own route by its id", () => {
    expect(resultHref("example", { kind: "npc", id: "fenn" })).toBe(
      "/campaigns/example/npcs/fenn",
    );
  });

  test("a location hit opens the location's own route by its id", () => {
    expect(resultHref("example", { kind: "location", id: "lighthouse" })).toBe(
      "/campaigns/example/locations/lighthouse",
    );
  });
});
