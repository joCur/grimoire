// The slug rule (issue #56) — the module both sides derive ids with.
//
// It matters that these cases are here and not in one of the two consumers:
// the app shows the id it derives BEFORE the POST and the server derives the
// id it stores, so any disagreement between them is a lie on screen. One
// module, one set of cases.

import { describe, expect, test } from "bun:test";
import { ENTITY_SLUG, freeSlug, isEntityId, slugVariant, toSlug } from "../src/slug";

describe("toSlug", () => {
  test("kebab-cases a display name", () => {
    expect(toSlug("Ankunft am Leuchtturm")).toBe("ankunft-am-leuchtturm");
    expect(toSlug("01 Salzhafen")).toBe("01-salzhafen");
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
    expect(toSlug("  Der alte Hafen!  ")).toBe("der-alte-hafen");
    expect(toSlug("Was nun??? — Der Sturm")).toBe("was-nun-der-sturm");
    expect(toSlug("-Rand-")).toBe("rand");
  });

  test("yields nothing when nothing maps into a-z0-9", () => {
    // The caller has to say so — an id is never invented (store/write.ts).
    expect(toSlug("!!!")).toBe("");
    expect(toSlug("   ")).toBe("");
    expect(toSlug("東京")).toBe("");
  });

  test("what it produces is always a legal id", () => {
    for (const name of ["Küste von Salzhafen", "01 — Prolog", "Señor Núñez!!", "a"]) {
      expect(isEntityId(toSlug(name))).toBe(true);
    }
  });
});

describe("isEntityId", () => {
  test("accepts kebab slugs", () => {
    expect(isEntityId("hafen")).toBe(true);
    expect(isEntityId("alte-fischerin")).toBe(true);
    expect(isEntityId("01-salzhafen")).toBe(true);
  });

  test("rejects everything the format's reference keys are not", () => {
    for (const value of ["", "Hafen", "der alte hafen", "hafen--2", "-hafen", "hafen-", "npcs/x", "hä"]) {
      expect(isEntityId(value)).toBe(false);
    }
  });

  test("the regex is the same predicate (it is exported for the server's guards)", () => {
    expect(ENTITY_SLUG.test("hafen")).toBe(true);
    expect(ENTITY_SLUG.test("Hafen")).toBe(false);
  });
});

describe("slugVariant / freeSlug", () => {
  test("the first variant is the slug itself", () => {
    expect(slugVariant("hafen", 1)).toBe("hafen");
    expect(slugVariant("hafen", 2)).toBe("hafen-2");
  });

  test("a trailing number is not parsed apart", () => {
    // `kapitel-2` can perfectly well be the name a DM chose.
    expect(slugVariant("kapitel-2", 2)).toBe("kapitel-2-2");
  });

  test("freeSlug returns the slug when it is free", () => {
    expect(freeSlug("hafen", () => false)).toBe("hafen");
  });

  test("freeSlug walks past every taken variant", () => {
    const taken = new Set(["hafen", "hafen-2", "hafen-3"]);
    expect(freeSlug("hafen", (c) => taken.has(c))).toBe("hafen-4");
  });

  test("freeSlug terminates even when everything is taken", () => {
    expect(freeSlug("hafen", () => true)).toBe("hafen-200");
  });

  test("every proposal is itself a legal id", () => {
    const taken = new Set(["hafen"]);
    expect(isEntityId(freeSlug("hafen", (c) => taken.has(c)))).toBe(true);
  });
});
