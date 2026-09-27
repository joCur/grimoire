// Where a location lives in the app: its reading view and its list.

import { describe, expect, test } from "bun:test";

import { locationHref, locationLabel, locationsHref } from "./location-links";

describe("location links", () => {
  test("the reading view and the list are the location's own routes", () => {
    expect(locationHref("example", "lighthouse")).toBe("/campaigns/example/locations/lighthouse");
    expect(locationsHref("example")).toBe("/campaigns/example/locations");
    expect(locationLabel("lighthouse")).toBe("locations/lighthouse");
  });
});
