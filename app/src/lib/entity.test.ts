import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";
import { browseListTitle, entityHeaderKind } from "./entity";

// The labels come from the catalog and the translator is passed in, so a test
// says which language it asserts.
const t = translator("de");

describe("entityHeaderKind", () => {
  test("scene keeps the scene article", () => {
    expect(entityHeaderKind("scene")).toBe("scene");
  });

  test("everything else is a plain titled header — never the scene overline", () => {
    for (const kind of ["chapter", "campaign", "session", "inbox", "glossary", "unknown"] as const) {
      expect(entityHeaderKind(kind)).toBe("titled");
    }
  });
});

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
