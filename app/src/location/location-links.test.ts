// Where a location lives in the app: its reading view, its list, and the
// context line of its reading view.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n";

import { locationHref, locationLabel, locationPageCrumbs, locationsHref } from "./location-links";

const de = translator("de");
const en = translator("en");

describe("location links", () => {
  test("the reading view and the list are the location's own routes", () => {
    expect(locationHref("beispiel", "leuchtturm")).toBe("/campaigns/beispiel/locations/leuchtturm");
    expect(locationsHref("beispiel")).toBe("/campaigns/beispiel/locations");
    expect(locationLabel("leuchtturm")).toBe("locations/leuchtturm");
  });

  test("the reading view points at THE location list, never at a chapter", () => {
    expect(locationPageCrumbs("beispiel", de)).toEqual([
      { label: "Orte", to: "/campaigns/beispiel/locations" },
    ]);
  });

  test("the list label follows the UI language", () => {
    expect(locationPageCrumbs("beispiel", en)).toEqual([
      { label: "Locations", to: "/campaigns/beispiel/locations" },
    ]);
  });

  test("no campaign yields nothing", () => {
    expect(locationPageCrumbs("", de)).toEqual([]);
  });
});
