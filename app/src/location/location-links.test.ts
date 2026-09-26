// Where a location lives in the app: its reading view, its list, and the
// context line of its reading view.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n";

import { locationHref, locationLabel, locationPageCrumbs, locationsHref } from "./location-links";

const de = translator("de");
const en = translator("en");

describe("location links", () => {
  test("the reading view and the list are the location's own routes", () => {
    expect(locationHref("example", "lighthouse")).toBe("/campaigns/example/locations/lighthouse");
    expect(locationsHref("example")).toBe("/campaigns/example/locations");
    expect(locationLabel("lighthouse")).toBe("locations/lighthouse");
  });

  test("the reading view points at THE location list, never at a chapter", () => {
    expect(locationPageCrumbs("example", de)).toEqual([
      { label: de("browse.title.locations"), to: "/campaigns/example/locations" },
    ]);
  });

  test("the list label follows the UI language", () => {
    expect(locationPageCrumbs("example", en)).toEqual([
      { label: en("browse.title.locations"), to: "/campaigns/example/locations" },
    ]);
  });

  test("no campaign yields nothing", () => {
    expect(locationPageCrumbs("", de)).toEqual([]);
  });
});
