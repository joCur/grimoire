import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";
import { browseListTitle } from "./browse";

// The labels come from the catalog and the translator is passed in, so a test
// says which language it asserts.
const t = translator("de");

describe("browseListTitle", () => {
  test("the three list pages have German titles", () => {
    expect(browseListTitle("scenes", t)).toBe("Szenen");
    expect(browseListTitle("npcs", t)).toBe("NPCs");
    expect(browseListTitle("locations", t)).toBe("Orte");
  });

  test("a kind without a list has no title (the page says so)", () => {
    expect(browseListTitle("dragons", t)).toBeUndefined();
    expect(browseListTitle("", t)).toBeUndefined();
  });
});
