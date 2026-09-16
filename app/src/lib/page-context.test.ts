import { describe, expect, test } from "bun:test";
import type { CampaignTree } from "@grimoire/shared/types";

import { translator } from "@/i18n";

import { pageContextCrumbs } from "./page-context";

const de = translator("de");
const en = translator("en");

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [{ id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm von Salzhafen", groups: [] }],
  npcs: [],
  locations: [
    { path: "locations/leuchtturm", id: "leuchtturm", name: "Der Leuchtturm von Salzhafen" },
  ],
  sessions: [],
};

describe("pageContextCrumbs", () => {
  test("a grouped scene reads chapter title then group, chapter links to the pool", () => {
    expect(
      pageContextCrumbs("beispiel", "01-salzhafen/hafen/ankunft-leuchtturm", tree, de),
    ).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/beispiel" },
      // No location file for "hafen" — the slug stands as written.
      { label: "hafen" },
    ]);
  });

  test("a group WITH a location file shows the location's name", () => {
    expect(
      pageContextCrumbs("beispiel", "01-salzhafen/leuchtturm/aufstieg", tree, de),
    ).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/beispiel" },
      { label: "Der Leuchtturm von Salzhafen" },
    ]);
  });

  test("a scene directly in the chapter directory has no group crumb", () => {
    expect(pageContextCrumbs("beispiel", "01-salzhafen/prolog", tree, de)).toEqual([
      { label: "Kapitel 1: Der Leuchtturm von Salzhafen", to: "/beispiel" },
    ]);
  });

  test("npc and location views point at THEIR list, never at a chapter", () => {
    expect(pageContextCrumbs("beispiel", "npcs/fenn", tree, de)).toEqual([
      { label: "NPCs", to: "/beispiel/list/npcs" },
    ]);
    expect(pageContextCrumbs("beispiel", "locations/leuchtturm", tree, de)).toEqual([
      { label: "Orte", to: "/beispiel/list/locations" },
    ]);
  });

  test("the list labels follow the UI language (issue #69)", () => {
    expect(pageContextCrumbs("beispiel", "npcs/fenn", tree, en)).toEqual([
      { label: "NPCs", to: "/beispiel/list/npcs" },
    ]);
    expect(pageContextCrumbs("beispiel", "locations/leuchtturm", tree, en)).toEqual([
      { label: "Locations", to: "/beispiel/list/locations" },
    ]);
  });

  test("the campaign name never appears in the context line", () => {
    const labels = [
      ...pageContextCrumbs("beispiel", "npcs/fenn", tree, de),
      ...pageContextCrumbs("beispiel", "01-salzhafen/prolog", tree, de),
    ].map((c) => c.label);
    expect(labels).not.toContain("beispiel");
  });

  test("files outside the hierarchy get no context line", () => {
    for (const path of ["campaign", "sessions/2026-01-15", "inbox", "glossary"]) {
      expect(pageContextCrumbs("beispiel", path, tree, de)).toEqual([]);
    }
  });

  test("degrades: unknown chapter keeps its id, no tree keeps every raw value", () => {
    expect(pageContextCrumbs("beispiel", "09-unbekannt/szene", tree, de)).toEqual([
      { label: "09-unbekannt", to: "/beispiel" },
    ]);
    expect(pageContextCrumbs("beispiel", "01-salzhafen/hafen/x", undefined, de)).toEqual([
      { label: "01-salzhafen", to: "/beispiel" },
      { label: "hafen" },
    ]);
  });

  test("no campaign or no path yields nothing", () => {
    expect(pageContextCrumbs("", "npcs/fenn", tree, de)).toEqual([]);
    expect(pageContextCrumbs("beispiel", "", tree, de)).toEqual([]);
  });
});
