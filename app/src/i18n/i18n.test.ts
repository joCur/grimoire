// The catalog's own guarantees (issue #69).
//
// The KEY SET is enforced by the typecheck (en.ts is a `Record<MessageKey,
// string>`), so these tests cover what types cannot: that every pattern
// actually COMPILES in both languages, that the plural forms are real ICU and
// not a German sentence with an English number glued on, and that the browser
// preference maps the way AK2 says it does.

import { describe, expect, test } from "bun:test";

import { de } from "./de";
import { en } from "./en";
import { CATALOGS, formatDate, formatParts, translator } from "./format";
import { LOCALES, preferredLocale, type Locale, type MessageKey } from "./messages";

const KEYS = Object.keys(de) as MessageKey[];

describe("the catalogs", () => {
  test("hold the same keys in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(KEYS.slice().sort());
  });

  test("have no empty message", () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        expect(CATALOGS[locale][key].trim()).not.toBe("");
      }
    }
  });

  test("every pattern compiles and formats in every language", () => {
    // The parameters a message does not mention are ignored, so one generous
    // bag of values covers the whole catalog — what is being proven here is
    // that no pattern throws (a stray `{`, a broken plural).
    const params = {
      count: 2,
      name: "Salzhafen",
      id: "leuchtturm",
      path: "npcs/jorna",
      label: "Quickstats",
      row: 1,
      item: "combat",
      state: "Session läuft",
      elapsed: "0:12:33",
      date: "13.09.2026",
      kind: "Szene",
      oldId: "jorna",
    };
    for (const locale of LOCALES) {
      const t = translator(locale);
      for (const key of KEYS) {
        const out = t(key, params);
        expect(typeof out).toBe("string");
        // A pattern that failed to format falls back to the RAW pattern, so a
        // leftover `{` is the signature of exactly that.
        expect(out).not.toContain("{");
      }
    }
  });
});

describe("plural", () => {
  test("German picks singular and plural per count", () => {
    const t = translator("de");
    expect(t("rename.changed", { count: 1 })).toBe("betrifft 1 Eintrag");
    expect(t("rename.changed", { count: 3 })).toBe("betrifft 3 Einträge");
    expect(t("rename.usage.logEntries", { count: 1 })).toBe("1 Log-Zeile");
    expect(t("rename.usage.logEntries", { count: 0 })).toBe("0 Log-Zeilen");
  });

  test("English picks its own forms", () => {
    const t = translator("en");
    expect(t("rename.changed", { count: 1 })).toBe("affects 1 entry");
    expect(t("rename.changed", { count: 3 })).toBe("affects 3 entries");
    expect(t("rename.usage.total", { count: 1 })).toBe("1 use");
  });
});

describe("interpolation", () => {
  test("puts the value in, once, in the right place", () => {
    expect(translator("de")("campaign.switcher.current", { name: "Salzhafen" })).toBe(
      "Kampagne: Salzhafen",
    );
    expect(translator("en")("campaign.switcher.current", { name: "Salzhafen" })).toBe(
      "Campaign: Salzhafen",
    );
  });

  test("formatParts keeps a non-string value as its own part", () => {
    const marker = { mono: "jorna" };
    const parts = formatParts("de", "rename.newId.label", { oldId: marker });
    expect(parts).toContain(marker);
    expect(parts.filter((part) => typeof part === "string").join("")).toBe("neue id (aktuell )");
  });

  test("degrades to the raw pattern instead of throwing", () => {
    // A message that WANTS a parameter and gets none must still render
    // something (CLAUDE.md: the format degrades, it never errors).
    expect(() => translator("de")("rename.usage.total")).not.toThrow();
  });
});

describe("dates go through Intl", () => {
  const when = new Date(2026, 8, 13);
  test("German reads 13.09.2026, English 09/13/2026", () => {
    expect(formatDate("de", when)).toBe("13.09.2026");
    expect(formatDate("en", when)).toBe("09/13/2026");
  });
});

describe("preferredLocale (the default before anything is stored)", () => {
  const cases: [string[], Locale][] = [
    [["de"], "de"],
    [["de-DE"], "de"],
    [["de-AT", "en-US"], "de"],
    [["en-GB"], "en"],
    [["fr-FR"], "en"],
    [[], "en"],
    [["fr", "de"], "de"],
  ];
  for (const [languages, expected] of cases) {
    test(`${JSON.stringify(languages)} -> ${expected}`, () => {
      expect(preferredLocale(languages)).toBe(expected);
    });
  }
});
