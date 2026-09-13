// The message contract (issue #69, ADR #15).
//
// `de.ts` IS the key set: `MessageKey` is its `keyof`, and every other
// language is a total `Record<MessageKey, string>`. A key forgotten in `en.ts`
// fails `bun run typecheck` (missing property), a key that exists ONLY there
// fails too (excess property on an annotated object literal). That is the
// whole type-safety story, and it needs no build step.

import { de } from "./de";

/** Every message key the app may ask for. */
export type MessageKey = keyof typeof de;

/** A complete catalog — the shape every language file must satisfy. */
export type Messages = Record<MessageKey, string>;

/** The languages the UI ships (German is the primary one, CLAUDE.md). */
export const LOCALES = ["de", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";

/** The BCP-47 tag `Intl` is fed for a locale — dates, numbers, plural rules. */
export const INTL_TAG: Record<Locale, string> = {
  de: "de-DE",
  en: "en-US",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The language a browser asks for when the instance has no setting yet
 * (issue #69 AK2): `de*` -> German, everything else English. The SETTING
 * itself lives on the server — this is only the fallback for "not yet
 * decided", so it is read once and never written anywhere.
 */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    if (lower === "de" || lower.startsWith("de-")) return "de";
    if (lower === "en" || lower.startsWith("en-")) return "en";
  }
  return "en";
}

/**
 * `preferredLocale` against the real browser. NO INFORMATION AT ALL — no
 * `navigator`, or one without a language (Bun's global, a stripped embedder) —
 * answers with the primary language rather than with `preferredLocale`'s "not
 * German, so English": that branch is about a browser that ASKED for something
 * else, which is a different statement from silence.
 */
export function browserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const offered =
    navigator.languages !== undefined && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  const tags = offered.filter((tag): tag is string => typeof tag === "string" && tag !== "");
  if (tags.length === 0) return DEFAULT_LOCALE;
  return preferredLocale(tags);
}
