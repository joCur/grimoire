// UI text through its catalog key (decisions/testing): a test never spells a
// sentence of the UI itself. Where a role alone does not name an element, it
// asks the catalog for the label, so rewording a sentence changes the catalog
// and nothing here.

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
  return new RegExp(`^${ui(key, params).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}
