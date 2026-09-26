// The short form of a location its card, its preview and its reading view
// share: which fields it reads, and that a `[[slug]]` inside reads as a name.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import type { Location } from "@grimoire/shared/location";

import { locationExcerpt } from "./location-excerpt";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel");

/** A location fixture — the location as its resource answers it (decisions/resources). */
function locationFixture(id: string): Location {
  const stored = JSON.parse(
    readFileSync(path.join(FIXTURES, "locations", `${id}.json`), "utf8"),
  ) as Omit<Location, "rev">;
  return { ...stored, rev: 1 };
}

/** A location of nothing but what a case names. */
function location(fields: Partial<Location>): Location {
  return { id: "place", name: "Place", body: "", rev: 1, ...fields };
}

const NAMES: Record<string, string> = { fenn: "Fenn" };
const nameOf = (slug: string): string | undefined => NAMES[slug];

describe("locationExcerpt", () => {
  test("the `atmosphere` field and the Roll20 page", () => {
    expect(locationExcerpt(locationFixture("bucht"), nameOf)).toEqual({
      mood: "Arbeit, keine Romantik: Kisten unter Planen, ausgetretene Pfade, niemand redet laut.",
      page: "Nordbucht",
    });
  });

  test("a reference in the atmosphere reads as the current name", () => {
    const place = location({ atmosphere: "The quay smells of [[fenn]]s pipe tobacco." });
    expect(locationExcerpt(place, nameOf).mood).toBe("The quay smells of Fenns pipe tobacco.");
  });

  test("a `## Atmosphere` section in the body is not read — only the field is", () => {
    const place = location({
      roll20Page: "Cove",
      body: "## Atmosphere\n\nThis stands in the text and stays text.\n",
    });
    expect(locationExcerpt(place, nameOf)).toEqual({ mood: undefined, page: "Cove" });
  });
});
