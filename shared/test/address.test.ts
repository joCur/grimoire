// Taking an address apart. Small, and worth pinning: every caller that
// splits an address reads its segments here, so the one rule that matters —
// blanks are KEPT — has to stay put.

import { describe, expect, test } from "bun:test";
import { addressSegments } from "../src/address";

describe("addressSegments", () => {
  test("splits an address into its segments, in order", () => {
    expect(addressSegments("campaign")).toEqual(["campaign"]);
    expect(addressSegments("npcs/jorna")).toEqual(["npcs", "jorna"]);
    expect(addressSegments("01-salzhafen/leuchtturm/ankunft")).toEqual([
      "01-salzhafen",
      "leuchtturm",
      "ankunft",
    ]);
  });

  test("keeps blank segments — they are what makes an address name nothing", () => {
    expect(addressSegments("npcs/")).toEqual(["npcs", ""]);
    expect(addressSegments("/campaign")).toEqual(["", "campaign"]);
    expect(addressSegments("a//b")).toEqual(["a", "", "b"]);
    expect(addressSegments("")).toEqual([""]);
  });
});
