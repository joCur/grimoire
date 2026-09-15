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
    // The parameter names are READ OUT of the patterns themselves rather than
    // kept in a hand-maintained bag: a new key with a new placeholder used to
    // fail this test until somebody added its name here, which taught the
    // catalog nothing. `{count}` and the two counters are numbers (plural
    // needs one), everything else is a plain string.
    const NUMERIC = new Set(["count", "seen", "total", "row"]);
    const params: Record<string, string | number> = {};
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        for (const [, argument] of CATALOGS[locale][key].matchAll(/\{\s*(\w+)/g)) {
          const at = argument as string;
          params[at] = NUMERIC.has(at) ? 2 : `<${at}>`;
        }
      }
    }
    // Every catalog does mention SOMETHING, or this test proves nothing.
    expect(Object.keys(params).length).toBeGreaterThan(5);

    for (const locale of LOCALES) {
      const t = translator(locale);
      for (const key of KEYS) {
        const out = t(key, params);
        expect(typeof out).toBe("string");
        // A pattern that failed to format falls back to the RAW pattern, so a
        // leftover `{` is the signature of exactly that.
        expect(out, `${locale} ${key}`).not.toContain("{");
      }
    }
  });
});

// The typographic guard: the catalog used to write German
// quotation marks as an opening `„` closed by an ASCII `"`, and the generator
// prompts imitated the catalog. Scanned over the VALUES, not over the source
// text: there the closing ASCII `"` is indistinguishable from the string
// delimiter. The markdown side of the same rule — prompts, few-shots,
// examples/ — lives in server/test/typography.test.ts.
describe("German quotation marks", () => {
  /** `„` and, later in the same message, an ASCII `"` with no `“` between. */
  const MIXED = /\u201E[^\u201C]*"/;

  test("no German message closes a quotation with an ASCII quote", () => {
    const bad = KEYS.filter((key) => MIXED.test(de[key]));
    expect(bad).toEqual([]);
  });

  test("English closes with `“…”`, never with a stray `„`", () => {
    const bad = KEYS.filter((key) => en[key].includes("\u201E"));
    expect(bad).toEqual([]);
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
