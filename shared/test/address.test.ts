// Taking an address apart. Small, and worth pinning: every caller that used
// to split an address itself now reads its segments here, so the two rules
// that differ between those old call sites — blanks are KEPT, and the head of
// an empty address is `""` rather than undefined — have to stay put.

import { describe, expect, test } from "bun:test";
import { addressHead, addressSegments } from "../src/address";

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

describe("addressHead", () => {
  test("is the first segment", () => {
    expect(addressHead("npcs/jorna")).toBe("npcs");
    expect(addressHead("01-salzhafen/leuchtturm/ankunft")).toBe("01-salzhafen");
    expect(addressHead("campaign")).toBe("campaign");
  });

  test("is the empty string for an empty address, never undefined", () => {
    expect(addressHead("")).toBe("");
    expect(addressHead("/npcs/jorna")).toBe("");
  });
});
