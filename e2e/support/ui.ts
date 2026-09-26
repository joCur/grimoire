// UI text through its catalog key (decisions/testing): a test never spells a
// sentence of the UI itself. Where a role alone does not name an element, it
// asks the catalog for the label, so rewording a sentence changes the catalog
// and nothing here.

import escapeStringRegexp from "escape-string-regexp";

import { translator, type MessageParams } from "../../app/src/i18n/format";
import type { Locale, MessageKey } from "../../app/src/i18n/messages";

const translators = { de: translator("de"), en: translator("en") } as const;

/** The German UI text of a catalog key — the language the suite runs in. */
export function ui(key: MessageKey, params?: MessageParams): string {
  return translators.de(key, params);
}

/** The UI text of a catalog key in the given language. */
export function uiIn(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return translators[locale](key, params);
}

/** A catalog text as an exact, anchored pattern — for names that must match whole. */
export function uiExact(key: MessageKey, params?: MessageParams): RegExp {
  return new RegExp(`^${escapeStringRegexp(ui(key, params))}$`);
}

/** Parameters of `uiPattern`: a literal value, or a RegExp whose source fills an open slot. */
export type PatternParams = Record<string, string | number | RegExp>;

/**
 * A catalog text as a pattern: literal parameters match as written, a RegExp
 * parameter is an open slot (its groups capture). An open slot is rendered as
 * a small sentinel number first, so a plural picks its "other" form.
 * `exact` anchors the whole text.
 */
export function uiPattern(
  key: MessageKey,
  params: PatternParams = {},
  { exact = false, locale = "de" }: { exact?: boolean; locale?: Locale } = {},
): RegExp {
  const slots = Object.entries(params).flatMap(([name, value], index) =>
    value instanceof RegExp ? [{ name, sentinel: String(941 + index * 2), source: value.source }] : [],
  );
  const rendered = uiIn(locale, key, {
    ...params,
    ...Object.fromEntries(slots.map((slot) => [slot.name, Number(slot.sentinel)])),
  });
  let source = escapeStringRegexp(rendered);
  for (const slot of slots) source = source.replace(slot.sentinel, () => slot.source);
  return new RegExp(exact ? `^${source}$` : source);
}
