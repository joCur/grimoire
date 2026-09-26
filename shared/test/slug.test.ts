// The slug rule — the module both sides derive ids with.
//
// It matters that these cases are here and not in one of the two consumers:
// the app shows the id it derives BEFORE the POST and the server derives the
// id it stores, so any disagreement between them is a lie on screen. One
// module, one set of cases.

import { describe, expect, test } from "bun:test";
import { ENTITY_SLUG, freeSlug, isEntityId, slugVariant, toSlug } from "../src/slug";

describe("toSlug", () => {
  test("kebab-cases a display name", () => {
    expect(toSlug("Arrival at the Lighthouse")).toBe("arrival-at-the-lighthouse");
    expect(toSlug("01 Salt Harbour")).toBe("01-salt-harbour");
  });

  test("transliterates the German four rather than folding them", () => {
    expect(toSlug("Küste")).toBe("kueste");
    expect(toSlug("Öffentliches Bad")).toBe("oeffentliches-bad");
    expect(toSlug("Schwärze")).toBe("schwaerze");
    expect(toSlug("Straße")).toBe("strasse");
  });

  test("folds every other diacritic", () => {
    expect(toSlug("Café Marée")).toBe("cafe-maree");
    expect(toSlug("Señor Núñez")).toBe("senor-nunez");
  });

  test("collapses punctuation and trims the dashes", () => {
    expect(toSlug("  The Old Harbour!  ")).toBe("the-old-harbour");
    expect(toSlug("What now??? — The Storm")).toBe("what-now-the-storm");
    expect(toSlug("-Edge-")).toBe("edge");
  });

  test("yields nothing when nothing maps into a-z0-9", () => {
    // The caller has to say so — an id is never invented (store/shared.ts).
    expect(toSlug("!!!")).toBe("");
    expect(toSlug("   ")).toBe("");
    expect(toSlug("東京")).toBe("");
  });

  test("what it produces is always a legal id", () => {
    for (const name of ["Harbour Straße", "01 — Prologue", "Señor Núñez!!", "a"]) {
      expect(isEntityId(toSlug(name))).toBe(true);
    }
  });
});

describe("isEntityId", () => {
  test("accepts kebab slugs", () => {
    expect(isEntityId("harbour")).toBe(true);
    expect(isEntityId("old-fisherwoman")).toBe(true);
    expect(isEntityId("01-salt-harbour")).toBe(true);
  });

  test("rejects everything the format's reference keys are not", () => {
    for (const value of ["", "Harbour", "the old harbour", "harbour--2", "-harbour", "harbour-", "npcs/x", "hä"]) {
      expect(isEntityId(value)).toBe(false);
    }
  });

  test("the regex is the same predicate (it is exported for the server's guards)", () => {
    expect(ENTITY_SLUG.test("harbour")).toBe(true);
    expect(ENTITY_SLUG.test("Harbour")).toBe(false);
  });
});

describe("slugVariant / freeSlug", () => {
  test("the first variant is the slug itself", () => {
    expect(slugVariant("harbour", 1)).toBe("harbour");
    expect(slugVariant("harbour", 2)).toBe("harbour-2");
  });

  test("a trailing number is not parsed apart", () => {
    // `chapter-2` can perfectly well be the name a DM chose.
    expect(slugVariant("chapter-2", 2)).toBe("chapter-2-2");
  });

  test("freeSlug returns the slug when it is free", () => {
    expect(freeSlug("harbour", () => false)).toBe("harbour");
  });

  test("freeSlug walks past every taken variant", () => {
    const taken = new Set(["harbour", "harbour-2", "harbour-3"]);
    expect(freeSlug("harbour", (c) => taken.has(c))).toBe("harbour-4");
  });

  test("freeSlug terminates even when everything is taken", () => {
    expect(freeSlug("harbour", () => true)).toBe("harbour-200");
  });

  test("every proposal is itself a legal id", () => {
    const taken = new Set(["harbour"]);
    expect(isEntityId(freeSlug("harbour", (c) => taken.has(c)))).toBe(true);
  });
});
