// The catalog's own guarantees. The i18n layer is this repo's own code
// (format.ts: interpolation, ICU plural, dates through Intl) — there is no
// framework whose tests would cover it.
//
// The KEY SET is enforced by the typecheck (en.ts is a `Record<MessageKey,
// string>`), so these tests cover what types cannot: that every pattern
// actually COMPILES in both languages, that the plural forms are real ICU and
// not a sentence of one language with a number glued on, and that the browser
// preference maps to a supported locale.

import { describe, expect, test } from "bun:test";

import { de } from "./de";
import { en } from "./en";
import { CATALOGS, formatDate, formatParts, pattern, translator } from "./format";
import { LOCALES, preferredLocale, type Locale, type MessageKey } from "./messages";

const KEYS = Object.keys(de) as MessageKey[];

describe("the catalogs", () => {
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

// The typographic guard: a German quotation opens with the low mark (U+201E)
// and closes with U+201C, never with an ASCII `"`, and the generator prompts
// imitate the catalog. Scanned over the VALUES, not over the source
// text: there the closing ASCII `"` is indistinguishable from the string
// delimiter. The markdown side of the same rule — prompts, few-shots,
// fixtures — lives in server/test/typography.test.ts.
describe("German quotation marks", () => {
  /** U+201E and, later in the same message, an ASCII `"` with no U+201C between. */
  const MIXED = /\u201E[^\u201C]*"/;

  test("no German message closes a quotation with an ASCII quote", () => {
    const bad = KEYS.filter((key) => MIXED.test(de[key]));
    expect(bad).toEqual([]);
  });

  test("no English message carries the German opening mark U+201E", () => {
    const bad = KEYS.filter((key) => en[key].includes("\u201E"));
    expect(bad).toEqual([]);
  });
});

describe("plural", () => {
  // The number leads the phrase and the noun after it follows the plural
  // category: one form for 1, another for every other count.
  const KEYS_WITH_PLURAL = ["mobileStart.count.scenes", "mobileStart.count.locations"] as const;

  /** The phrase after the number, for a count. */
  function noun(locale: Locale, key: MessageKey, count: number): string {
    const out = translator(locale)(key, { count });
    expect(out.startsWith(`${count} `)).toBe(true);
    return out.slice(`${count} `.length);
  }

  for (const locale of LOCALES) {
    test(`${locale} picks singular and plural per count`, () => {
      for (const key of KEYS_WITH_PLURAL) {
        expect(noun(locale, key, 1)).not.toBe(noun(locale, key, 3));
        // Zero is not singular.
        expect(noun(locale, key, 0)).toBe(noun(locale, key, 3));
      }
    });
  }

  test("each language brings its own forms", () => {
    for (const key of KEYS_WITH_PLURAL) {
      for (const count of [1, 3]) {
        expect(noun("en", key, count)).not.toBe(noun("de", key, count));
      }
    }
  });
});

describe("interpolation", () => {
  test("puts the value in, once, in the right place", () => {
    for (const locale of LOCALES) {
      const out = translator(locale)("campaign.switcher.current", { name: "Salt Harbour" });
      expect(out).toBe(pattern(locale, "campaign.switcher.current").replace("{name}", "Salt Harbour"));
      expect(out.split("Salt Harbour")).toHaveLength(2);
    }
  });

  test("formatParts keeps a non-string value as its own part", () => {
    const marker = { mono: "salt-harbour" };
    const parts = formatParts("de", "campaign.switcher.current", { name: marker });
    expect(parts).toContain(marker);
    expect(parts.filter((part) => typeof part === "string").join("")).toBe(
      pattern("de", "campaign.switcher.current").replace("{name}", ""),
    );
  });

  test("degrades to the raw pattern instead of throwing", () => {
    // A message that WANTS a parameter and gets none must still render
    // something (CLAUDE.md: the format degrades, it never errors).
    expect(() => translator("de")("mobileStart.count.scenes")).not.toThrow();
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
