// The i18n entry point (issue #69, ADR #15).
//
//   const t = useT();            <span>{t("session.start")}</span>
//   const { locale, date } = useI18n();
//
// In a pure helper, take `Translate` as a parameter instead of importing a
// catalog — the lib layer must not decide which language the UI is in
// (lib/create.ts, lib/properties-form.ts, lib/session.ts do it
// that way).

export { de } from "./de";
export { en } from "./en";
export {
  CATALOGS,
  formatDate,
  formatParts,
  pattern,
  translator,
  type MessageParams,
  type Translate,
} from "./format";
export {
  browserLocale,
  DEFAULT_LOCALE,
  INTL_TAG,
  isLocale,
  LOCALES,
  preferredLocale,
  type Locale,
  type MessageKey,
  type Messages,
} from "./messages";
export { I18nProvider, SETTINGS_KEY, useI18n, useT, type I18n } from "./provider";
export { serverErrorBodyMessage, serverErrorMessage } from "./server-errors";
